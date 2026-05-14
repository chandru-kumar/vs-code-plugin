import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { PilotCodeSettings } from '../config/settings';
import {
  CompletionClient,
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
 *   5. caches the most recent result to avoid duplicate round-trips.
 */
export class PilotCodeInlineProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly debouncer: AsyncDebouncer;
  private readonly client: CompletionClient;
  private lastResult: { key: string; text: string } | undefined;

  constructor(
    private readonly getSettings: () => PilotCodeSettings,
    private readonly logger: Logger,
    private readonly statusBar: StatusBar
  ) {
    this.client = new CompletionClient(getSettings, logger);
    this.debouncer = new AsyncDebouncer(getSettings().completionDebounceMs);
  }

  updateDebounce(ms: number): void {
    this.debouncer.setDelay(ms);
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
      return [toItem(this.lastResult.text, position)];
    }

    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    const count = Math.max(1, Math.min(3, s.completionCount));
    let didSetBusy = false;

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

      if (processed.length === 0) {
        return undefined;
      }

      this.lastResult = { key, text: processed[0] };
      this.logger.debug(
        `inline: ${processed.length} suggestion(s) in ` +
          `${results[0]?.elapsedMs ?? 0}ms (${results[0]?.strategy ?? '?'})`
      );
      return processed.map((t) => toItem(t, position));
    } catch (err) {
      if (err instanceof DebounceCancelled) {
        return undefined; // superseded by a newer keystroke — expected
      }
      this.logger.error('inline completion failed', err);
      return undefined;
    } finally {
      sub.dispose();
      if (didSetBusy) {
        this.statusBar.setBusy(false);
      }
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
