import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { readSettings } from '../config/settings';
import { CompletionClient } from './completionClient';
import type { CompletionContext } from '../completions/contextGatherer';

/**
 * Fires one tiny throw-away completion to load the configured completion
 * model into Ollama's RAM, so the user's first real ghost-text request
 * doesn't pay the cold-load latency (often 10-30 s for 7B+ models).
 *
 * Runs in the background after activation; any failure is logged but
 * never bubbled up — prewarm is an optimisation, not a correctness
 * requirement.
 */
export async function prewarmCompletionModel(logger: Logger): Promise<void> {
  const s = readSettings();
  if (!s.prewarmOnActivation) {
    logger.debug('prewarm: skipped — bosch-copilot.prewarmOnActivation is false');
    return;
  }
  if (!s.enableInlineCompletions) {
    logger.debug('prewarm: skipped — inline completions are disabled');
    return;
  }

  const ctx: CompletionContext = {
    prefix: '// bosch-copilot prewarm\n',
    suffix: '\n',
    languageId: 'javascript',
    fileName: '.bosch-copilot-prewarm',
  };

  const cts = new vscode.CancellationTokenSource();
  // Generous timeout — first cold load of a 7B+ model on slow disk can
  // genuinely take 30-40 s. If it takes longer than this, we give up
  // and let the user's real request handle it.
  const timeout = setTimeout(() => cts.cancel(), 45_000);

  const started = Date.now();
  logger.info(
    `prewarm: warming completion model '${s.completionModel}' on ${s.endpoint}…`
  );

  try {
    const client = new CompletionClient(readSettings, logger);
    const result = await client.complete(ctx, cts.token);
    const elapsed = Date.now() - started;
    if (result) {
      logger.info(
        `prewarm: '${s.completionModel}' ready in ${elapsed}ms (${result.strategy}). ` +
          `First user completion should now be fast.`
      );
    } else {
      logger.warn(
        `prewarm: completed in ${elapsed}ms with no result. ` +
          `First user request may still pay the cold-load cost.`
      );
    }
  } catch (err) {
    const elapsed = Date.now() - started;
    logger.warn(
      `prewarm: failed after ${elapsed}ms — first user request may be slow`
    );
    logger.debug('prewarm error', err);
  } finally {
    clearTimeout(timeout);
    cts.dispose();
  }
}
