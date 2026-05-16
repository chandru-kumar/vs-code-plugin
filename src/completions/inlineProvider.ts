import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { PilotCodeSettings } from '../config/settings';
import {
  CompletionClient,
  ModelNotFoundError,
  type CompletionResult,
} from '../model/completionClient';
import { gatherContext } from './contextGatherer';
import { AsyncDebouncer, DebounceCancelled } from './debouncer';
import { trimSuffixOverlap } from './promptStrategies';
import type { StatusBar } from '../ui/statusBar';

/**
 * The ghost-text provider. VS Code calls `provideInlineCompletionItems`
 * on essentially every keystroke; this class:
 *   1. cheaply bails on disabled / non-file / empty-context cases,
 *   2. debounces so the local model isn't hammered,
 *   3. bridges VS Code's CancellationToken to an AbortSignal,
 *   4. supports N parallel alternative suggestions,
 *   5. caches the most recent result to avoid duplicate round-trips,
 *   6. logs every outcome at INFO so the user can see the pipeline,
 *   7. dedupes repeated errors and surfaces model-not-found just once.
 */
export class PilotCodeInlineProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly debouncer: AsyncDebouncer;
  private readonly client: CompletionClient;
  private lastResult: { key: string; text: string } | undefined;
  private readonly notifiedMissingModels = new Set<string>();
  private lastErrorKey = '';
  private lastErrorAt = 0;
  private firstSuccessLogged = false;

  constructor(
    private readonly getSettings: () => PilotCodeSettings,
    private readonly logger: Logger,
    private readonly statusBar: StatusBar
  ) {
    this.client = new CompletionClient(getSettings, logger);
    this.debouncer = new AsyncDebouncer(getSettings().completionDebounceMs);
  }

  /**
   * Called from the extension-wide settings-change listener. Updates the
   * debounce window and clears all per-session caches/notifications so
   * the user gets a fresh start after fixing config (e.g. correcting a
   * model-name typo).
   */
  onSettingsChanged(next: PilotCodeSettings): void {
    this.debouncer.setDelay(next.completionDebounceMs);
    this.notifiedMissingModels.clear();
    this.lastResult = undefined;
    this.lastErrorKey = '';
    this.lastErrorAt = 0;
    // Reset the first-success marker so the user sees the celebration
    // again after, e.g., switching to a different completion model.
    this.firstSuccessLogged = false;
  }

  dispose(): void {
    this.debouncer.dispose();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const s = this.getSettings();
    if (!s.enableInlineCompletions) {
      return undefined;
    }
    if (
      document.uri.scheme !== 'file' &&
      document.uri.scheme !== 'untitled'
    ) {
      return undefined;
    }
    if (token.isCancellationRequested) {
      return undefined;
    }

    const ctx = gatherContext(
      document,
      position,
      s.completionPrefixLines,
      s.completionSuffixLines,
      s.completionMaxContextChars
    );
    if (ctx.prefix.trim().length === 0 && ctx.suffix.trim().length === 0) {
      return undefined;
    }

    const key = cacheKey(document.uri.toString(), ctx.prefix, ctx.suffix);
    if (this.lastResult?.key === key && this.lastResult.text.length > 0) {
      this.logger.debug('inline: cache hit');
      return [toItem(this.lastResult.text, position)];
    }

    this.logger.debug(
      `inline: fired (file=${ctx.fileName}, model=${s.completionModel}, ` +
        `prefixLen=${ctx.prefix.length}, suffixLen=${ctx.suffix.length})`
    );

    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    const count = Math.max(1, Math.min(3, s.completionCount));
    let didSetBusy = false;
    const firedAt = Date.now();

    try {
      const results = await this.debouncer.run<CompletionResult[]>(async () => {
        if (token.isCancellationRequested) {
          return [];
        }
        this.statusBar.setBusy(true);
        didSetBusy = true;

        if (count === 1) {
          const r = await this.client.complete(ctx, token);
          return r ? [r] : [];
        }
        const temps = spreadTemperatures(s.completionTemperature, count);
        const parallel = await Promise.all(
          temps.map((t) => this.client.complete(ctx, token, t))
        );
        return parallel.filter(
          (r): r is CompletionResult => r !== undefined
        );
      }, abort.signal);

      if (results.length === 0) {
        // Either the request was cancelled (likely a fresh keystroke
        // arrived) or `complete()` swallowed an error it already logged.
        // Don't log INFO here — it would dominate the channel during
        // active typing. Debug is enough.
        this.logger.debug(
          `inline: no result (${Date.now() - firedAt}ms — cancelled or errored)`
        );
        return undefined;
      }

      const processed: string[] = [];
      const seen = new Set<string>();
      for (const r of results) {
        const text = postProcess(r.text, ctx.suffix, s.completionMultiline);
        if (text.length === 0 || seen.has(text)) {
          continue;
        }
        seen.add(text);
        processed.push(text);
      }

      const elapsed = results[0]?.elapsedMs ?? 0;
      const strategy = results[0]?.strategy ?? '?';

      if (processed.length === 0) {
        this.logger.info(
          `inline: model returned empty/whitespace (${elapsed}ms, ${strategy})`
        );
        return undefined;
      }

      this.lastResult = { key, text: processed[0] };
      this.logger.info(
        `inline: ${processed.length} suggestion${
          processed.length === 1 ? '' : 's'
        } in ${elapsed}ms (${strategy}, ${processed[0].length} chars)`
      );

      // One-shot session marker — makes it unambiguous that PilotCode +
      // the configured local model are alive, even at the default log
      // level. Reset on settings change so model switches re-celebrate.
      if (!this.firstSuccessLogged) {
        this.firstSuccessLogged = true;
        this.logger.info(
          `🎉 PilotCode: first inline completion from '${s.completionModel}' ` +
            `via ${s.endpoint} succeeded (${elapsed}ms, ${strategy}). ` +
            `Inline completions are LIVE.`
        );
      }

      return processed.map((t) => toItem(t, position));
    } catch (err) {
      if (err instanceof DebounceCancelled) {
        return undefined; // superseded by a newer keystroke — expected
      }
      if (err instanceof ModelNotFoundError) {
        this.handleModelNotFound(err, s.endpoint);
        return undefined;
      }
      this.logRateLimited(err);
      return undefined;
    } finally {
      sub.dispose();
      if (didSetBusy) {
        this.statusBar.setBusy(false);
      }
    }
  }

  private handleModelNotFound(
    err: ModelNotFoundError,
    endpoint: string
  ): void {
    if (this.notifiedMissingModels.has(err.modelName)) {
      // Already told the user about this exact missing model. Quiet.
      this.logger.debug(
        `inline: model '${err.modelName}' still missing — suppressing repeat notification`
      );
      return;
    }
    this.notifiedMissingModels.add(err.modelName);
    this.logger.error(
      `inline: completion model '${err.modelName}' not found on ${endpoint}`
    );
    void vscode.window
      .showWarningMessage(
        `PilotCode: completion model '${err.modelName}' not found on ${endpoint}.`,
        'Run Diagnose',
        'Open Settings'
      )
      .then((choice) => {
        if (choice === 'Run Diagnose') {
          void vscode.commands.executeCommand('pilotcode.diagnose');
        } else if (choice === 'Open Settings') {
          void vscode.commands.executeCommand('pilotcode.openSettings');
        }
      });
  }

  private logRateLimited(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const key = msg.slice(0, 120);
    const now = Date.now();
    // Same error within 30 s is logged at DEBUG to stop the channel
    // being flooded by N identical 404s during rapid typing.
    if (key !== this.lastErrorKey || now - this.lastErrorAt > 30_000) {
      this.logger.error('inline completion failed', err);
      this.lastErrorKey = key;
      this.lastErrorAt = now;
    } else {
      this.logger.debug(`inline: repeat error suppressed (${msg.slice(0, 80)})`);
    }
  }
}

function toItem(
  text: string,
  position: vscode.Position
): vscode.InlineCompletionItem {
  return new vscode.InlineCompletionItem(
    text,
    new vscode.Range(position, position)
  );
}

function cacheKey(uri: string, prefix: string, suffix: string): string {
  // The tail of the prefix + head of the suffix uniquely identify the
  // cursor situation well enough for a single-entry cache.
  return `${uri}::${prefix.slice(-256)}::${suffix.slice(0, 64)}`;
}

function spreadTemperatures(base: number, count: number): number[] {
  const temps: number[] = [];
  for (let i = 0; i < count; i++) {
    temps.push(Math.min(2, Number((base + i * 0.25).toFixed(2))));
  }
  return temps;
}

function postProcess(
  raw: string,
  suffix: string,
  multiline: boolean
): string {
  let text = trimSuffixOverlap(raw, suffix);
  if (!multiline) {
    const nl = text.indexOf('\n');
    if (nl >= 0) {
      text = text.slice(0, nl);
    }
  }
  return text.trim().length === 0 ? '' : text;
}
