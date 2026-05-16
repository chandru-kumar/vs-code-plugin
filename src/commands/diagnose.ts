import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { readSettings } from '../config/settings';
import { CompletionClient } from '../model/completionClient';
import { resolveStrategy } from '../completions/promptStrategies';
import type { CompletionContext } from '../completions/contextGatherer';

/**
 * One-button diagnostic: pings the endpoint, lists installed models,
 * validates the configured chat + completion models, resolves the
 * completion strategy, and fires a real round-trip test completion.
 *
 * Results are dropped into a new markdown editor the user can read,
 * copy, or paste back to a maintainer.
 */
export async function runDiagnose(logger: Logger): Promise<void> {
  logger.info('Diagnose: starting');
  const s = readSettings();
  const lines: string[] = [];
  const write = (s: string): number => lines.push(s);
  const ok = (msg: string): void => {
    write(`- ✅ ${msg}`);
  };
  const bad = (msg: string): void => {
    write(`- ❌ ${msg}`);
  };
  const info = (msg: string): void => {
    write(`- ℹ️ ${msg}`);
  };

  write('# PilotCode Diagnose');
  write('');
  write(`_Generated: ${new Date().toISOString()}_`);
  write('');
  write('## Configuration');
  write('```json');
  write(
    JSON.stringify(
      {
        endpoint: s.endpoint,
        chatModel: s.chatModel,
        completionModel: s.completionModel,
        completionStrategy: s.completionStrategy,
        completionDebounceMs: s.completionDebounceMs,
        completionMaxTokens: s.completionMaxTokens,
        completionTemperature: s.completionTemperature,
        enableInlineCompletions: s.enableInlineCompletions,
      },
      null,
      2
    )
  );
  write('```');
  write('');
  write('## Checks');

  // ------------------------------------------------------------ endpoint
  let available: string[] = [];
  try {
    const t0 = Date.now();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (s.apiKey) {
      headers.Authorization = `Bearer ${s.apiKey}`;
    }
    const res = await fetch(`${s.endpoint}/models`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    available = (body.data ?? []).map((m) => m.id);
    ok(
      `Endpoint reachable: \`${s.endpoint}\` (HTTP ${res.status}, ${Date.now() - t0}ms)`
    );
    ok(`Available models (${available.length}):`);
    available.forEach((m) => write(`    - \`${m}\``));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    bad(`Endpoint NOT reachable: \`${s.endpoint}\` — ${msg}`);
    write('');
    write('**Cannot continue without a reachable endpoint.** Common fixes:');
    write('- Make sure Ollama is running (`ollama serve`, or launch the Ollama app)');
    write('- Verify `pilotcode.endpoint` (default `http://localhost:11434/v1`)');
    write('- If using a remote host, set `pilotcode.apiKey` if required');
    logger.warn(`Diagnose: endpoint check failed — ${msg}`);
    await openMarkdownPanel(lines.join('\n'));
    return;
  }

  // ------------------------------------------------------------ chat model
  if (available.includes(s.chatModel)) {
    ok(`Chat model: \`${s.chatModel}\` — available`);
  } else {
    const suggest = closestMatch(s.chatModel, available);
    bad(`Chat model: \`${s.chatModel}\` — **NOT found**`);
    if (suggest) {
      write(`    - 💡 did you mean \`${suggest}\` ?`);
    }
  }

  // ------------------------------------------------------------ completion model
  if (available.includes(s.completionModel)) {
    ok(`Completion model: \`${s.completionModel}\` — available`);
  } else {
    const suggest = closestMatch(s.completionModel, available);
    bad(`Completion model: \`${s.completionModel}\` — **NOT found**`);
    if (suggest) {
      write(`    - 💡 did you mean \`${suggest}\` ?`);
    }
  }

  // ------------------------------------------------------------ strategy
  const strat = resolveStrategy(s.completionStrategy, s.completionModel);
  info(
    `Strategy resolved: \`${strat}\` (setting: \`${s.completionStrategy}\`, model: \`${s.completionModel}\`)`
  );

  // ------------------------------------------------------------ test request
  write('');
  write('## Test inline completion round-trip');
  if (!available.includes(s.completionModel)) {
    bad('Skipped — completion model is not available on the endpoint.');
  } else {
    const testCtx: CompletionContext = {
      prefix: 'function add(a, b) {\n  return ',
      suffix: '\n}\n',
      languageId: 'javascript',
      fileName: 'pilotcode-diagnose.js',
    };
    const cts = new vscode.CancellationTokenSource();
    const timeoutMs = 60_000;
    const timeout = setTimeout(() => cts.cancel(), timeoutMs);
    try {
      info(
        `Sending test prompt to \`${s.completionModel}\` ` +
          `(first call may take 10–30s while Ollama loads the model into RAM)…`
      );
      const client = new CompletionClient(readSettings, logger);
      const result = await client.complete(testCtx, cts.token);
      if (result) {
        ok(
          `Test completion succeeded in **${result.elapsedMs}ms** ` +
            `(strategy=${result.strategy}, ${result.text.length} chars)`
        );
        write('');
        write('Returned text:');
        write('```');
        write(result.text || '(empty string)');
        write('```');
      } else {
        bad(
          `Test completion returned **no result** (cancelled or errored). ` +
            `Check the PilotCode Output channel for details.`
        );
        if (cts.token.isCancellationRequested) {
          write(
            `    - This may be a cold-load timeout (>${timeoutMs / 1000}s). ` +
              `Try again — subsequent calls are typically fast.`
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bad(`Test completion threw: ${msg}`);
    } finally {
      clearTimeout(timeout);
      cts.dispose();
    }
  }

  // ------------------------------------------------------------ env checks
  write('');
  write('## If you still see no ghost text');
  write('1. **VS Code setting** `editor.inlineSuggest.enabled` must be `true` (default).');
  write('2. **Status bar** at bottom-right should show `$(rocket) PilotCode`. If it shows `$(circle-slash)`, click it to enable.');
  write('3. **Competing extensions** — if GitHub Copilot is installed and active in the Extension Development Host, it may take precedence. Disable it for the host or set `github.copilot.enable` to `false`.');
  write('4. **Model load time** — first request to a model can take 10–30 s while Ollama loads it into RAM. Pause typing for ~30 s after switching models so the first request can complete instead of being cancelled.');
  write('5. **Document scheme** — completions only fire in `file://` or `untitled:` documents (not in output panels, search results, settings editor, etc.).');

  logger.info('Diagnose: complete');
  await openMarkdownPanel(lines.join('\n'));
}

async function openMarkdownPanel(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  // Best-effort: also open the rendered preview to the side. If the
  // markdown extension is disabled, this no-ops.
  try {
    await vscode.commands.executeCommand('markdown.showPreviewToSide');
  } catch {
    /* ignore */
  }
}

function closestMatch(
  needle: string,
  haystack: string[]
): string | undefined {
  if (haystack.length === 0 || needle.length === 0) {
    return undefined;
  }
  let best: string | undefined;
  let bestScore = -1;
  for (const candidate of haystack) {
    const score = commonPrefixLen(needle, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Only suggest when at least 3 chars match — otherwise the suggestion
  // is more confusing than helpful.
  return bestScore >= 3 ? best : undefined;
}

function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) {
    i++;
  }
  return i;
}
