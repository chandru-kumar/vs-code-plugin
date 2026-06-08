import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';
import { getEditManager } from '../agent/editManager';

interface ApplyDiffInput {
  path: string;
  /** The old text that must currently exist in the file (exact match). */
  oldText: string;
  /** The replacement text. */
  newText: string;
}

class ApplyDiffTool implements vscode.LanguageModelTool<ApplyDiffInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ApplyDiffInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, oldText, newText } = options.input;
    if (oldText === newText) {
      return textResult(
        `apply_diff: oldText and newText are identical — no change.`
      );
    }
    const uri = resolveWorkspacePath(rel);
    const manager = getEditManager();

    // Operate on the *effective* content: if this file already has staged
    // edits this turn, build on top of them (not the stale disk version).
    const original = manager
      ? await manager.getEffectiveContent(uri)
      : new TextDecoder('utf-8').decode(
          await vscode.workspace.fs.readFile(uri)
        );

    const match = locateUnique(original, oldText);
    if (!match.ok) {
      if (match.reason === 'multiple') {
        throw new Error(
          `apply_diff: oldText matched ${match.count} times in ${rel}. ` +
            'Include more surrounding lines so the match is unique.'
        );
      }
      // No match — give the model an actionable hint instead of a dead end.
      throw new Error(
        `apply_diff: oldText not found in ${rel}.\n` +
          'The text could not be located even after tolerant matching ' +
          '(whitespace + quote-escaping were normalised). Common causes:\n' +
          '  • the snippet does not exist verbatim — call read_file to copy ' +
          'the exact current text, OR\n' +
          '  • you are rewriting a large section — call write_file with the ' +
          'COMPLETE new file content instead of many small diffs.\n' +
          nearbyHint(original, oldText)
      );
    }

    // Apply the located range. When matching needed de-escaping of the
    // oldText, the model very likely over-escaped newText too — de-escape it
    // the same way so we don't write literal backslashes into the file.
    const effectiveNew =
      match.strategy === 'de-escaped' ? deEscape(newText) : newText;
    const updated =
      original.slice(0, match.start) + effectiveNew + original.slice(match.end);

    if (match.strategy !== 'exact') {
      this.logger.debug(
        `apply_diff: matched via '${match.strategy}' fallback for ${rel}`
      );
    }

    if (manager) {
      const edit = await manager.stageModify(uri, updated);
      this.logger.debug(`apply_diff: staged patch to ${rel}`);
      return textResult(
        `Staged a patch to '${rel}' (+${edit.added}/-${edit.removed} lines). ` +
          `It will be shown to the user as a reviewable diff — do NOT assume ` +
          `it is applied yet. You may stage more edits to the same or other files.`
      );
    }

    // Fallback: write directly (invoked outside an agent turn).
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(updated)
    );
    return textResult(
      `Patched ${rel}: replaced ${oldText.length} chars with ${newText.length} chars.`
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ApplyDiffInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    // No confirmation card: edits are staged and reviewed as a diff.
    return {
      invocationMessage: `Staging patch to \`${options.input.path}\``,
    };
  }
}

type MatchStrategy = 'exact' | 'de-escaped' | 'normalized';

type LocateResult =
  | { ok: true; start: number; end: number; strategy: MatchStrategy }
  | { ok: false; reason: 'none' }
  | { ok: false; reason: 'multiple'; count: number };

/**
 * Locate a UNIQUE occurrence of `needle` in `text`, tolerant of the two
 * failure modes small models hit constantly:
 *   1. over-escaped quotes/backslashes (e.g. `\"` where the file has `"`),
 *   2. insignificant whitespace / line-ending differences.
 * Tries exact → de-escaped → line-trim-normalized, each requiring a unique
 * match. Returns character offsets into the ORIGINAL text.
 */
function locateUnique(text: string, needle: string): LocateResult {
  // 1. Exact.
  const exact = uniqueIndexOf(text, needle);
  if (exact.kind === 'unique') {
    return {
      ok: true,
      start: exact.index,
      end: exact.index + needle.length,
      strategy: 'exact',
    };
  }
  if (exact.kind === 'multiple') {
    return { ok: false, reason: 'multiple', count: exact.count };
  }

  // 2. De-escaped (strip the model's spurious backslashes before quotes etc.).
  const deEsc = deEscape(needle);
  if (deEsc !== needle) {
    const d = uniqueIndexOf(text, deEsc);
    if (d.kind === 'unique') {
      return {
        ok: true,
        start: d.index,
        end: d.index + deEsc.length,
        strategy: 'de-escaped',
      };
    }
    if (d.kind === 'multiple') {
      return { ok: false, reason: 'multiple', count: d.count };
    }
  }

  // 3. Whitespace/line-normalized (trailing space + CRLF agnostic).
  const norm = locateByNormalizedLines(text, needle);
  if (norm) {
    return { ok: true, start: norm.start, end: norm.end, strategy: 'normalized' };
  }

  return { ok: false, reason: 'none' };
}

function uniqueIndexOf(
  haystack: string,
  needle: string
): { kind: 'none' } | { kind: 'unique'; index: number } | { kind: 'multiple'; count: number } {
  if (needle.length === 0) {
    return { kind: 'none' };
  }
  const first = haystack.indexOf(needle);
  if (first === -1) {
    return { kind: 'none' };
  }
  const second = haystack.indexOf(needle, first + needle.length);
  if (second === -1) {
    return { kind: 'unique', index: first };
  }
  // count the rest for a helpful message
  let count = 2;
  let i = haystack.indexOf(needle, second + needle.length);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return { kind: 'multiple', count };
}

/** Remove one level of spurious escaping before quotes/backslashes. */
function deEscape(s: string): string {
  return s.replace(/\\(["'`\\])/g, '$1');
}

/**
 * Match `needle` against `text` comparing lines with trailing whitespace
 * trimmed and CRLF normalised. Returns the ORIGINAL char range covering the
 * matched lines, or null if not found / not unique.
 */
function locateByNormalizedLines(
  text: string,
  needle: string
): { start: number; end: number } | null {
  const textLines = splitWithOffsets(text);
  const needleLines = needle.replace(/\r\n/g, '\n').split('\n');
  // Drop a trailing empty line from the needle (common when it ends in \n).
  while (needleLines.length > 1 && needleLines[needleLines.length - 1] === '') {
    needleLines.pop();
  }
  const k = needleLines.length;
  if (k === 0) {
    return null;
  }
  const normNeedle = needleLines.map((l) => l.replace(/\s+$/, ''));

  let foundStart = -1;
  let foundEnd = -1;
  let matches = 0;
  for (let i = 0; i + k <= textLines.length; i++) {
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (textLines[i + j].text.replace(/\s+$/, '') !== normNeedle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matches++;
      if (matches > 1) {
        return null; // ambiguous
      }
      foundStart = textLines[i].start;
      foundEnd = textLines[i + k - 1].end;
    }
  }
  return matches === 1 ? { start: foundStart, end: foundEnd } : null;
}

function splitWithOffsets(
  text: string
): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      const end = text[i - 1] === '\r' ? i - 1 : i;
      out.push({ text: text.slice(start, end), start, end });
      start = i + 1;
    }
  }
  out.push({ text: text.slice(start), start, end: text.length });
  return out;
}

/** Best-effort "did you mean here?" hint pointing at the closest line. */
function nearbyHint(text: string, needle: string): string {
  const firstLine = needle
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3);
  if (!firstLine) {
    return '';
  }
  // Use the longest "word"/token from the first line as an anchor.
  const token = firstLine
    .split(/[\s<>"'=]+/)
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length)[0];
  if (!token) {
    return '';
  }
  const lines = text.split(/\r?\n/);
  const hits: string[] = [];
  for (let i = 0; i < lines.length && hits.length < 3; i++) {
    if (lines[i].includes(token)) {
      hits.push(`  line ${i + 1}: ${lines[i].trim().slice(0, 120)}`);
    }
  }
  return hits.length
    ? `\nClosest lines containing "${token}":\n${hits.join('\n')}`
    : '';
}

export const applyDiffTool: ToolDefinition<ApplyDiffInput> = {
  descriptor: {
    llmName: 'apply_diff',
    vsCodeName: 'bosch_copilot_apply_diff',
    description:
      'Replace a unique substring in a workspace file (matching is tolerant of ' +
      'whitespace and quote-escaping, but copy text verbatim from read_file ' +
      'when possible). `oldText` must identify ONE location — include enough ' +
      'surrounding lines to be unique. The change is STAGED and shown as a ' +
      'reviewable red/green diff. Best for SMALL, targeted edits. ' +
      'For a LARGE or multi-section rewrite of a file, do NOT chain many ' +
      'apply_diff calls — call write_file ONCE with the complete new content ' +
      'instead (more reliable). You may stage multiple edits before review.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative file path.',
        },
        oldText: {
          type: 'string',
          description:
            'Exact substring to replace (must match once, including whitespace).',
        },
        newText: {
          type: 'string',
          description: 'Replacement text.',
        },
      },
      required: ['path', 'oldText', 'newText'],
    },
    destructive: true,
  },
  factory: (logger) => new ApplyDiffTool(logger),
};
