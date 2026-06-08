import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';
import { getEditManager } from '../agent/editManager';

interface ReplaceLinesInput {
  path: string;
  startLine: number;
  endLine: number;
  newText: string;
}

/**
 * Replace an inclusive 1-based line range with `newText`. Unlike apply_diff,
 * this does NOT match text — it edits exactly the lines you name, so it is
 * immune to whitespace/quote/approximation mismatches. Pair it with
 * read_file_range / document_outline, which report line numbers.
 *
 * Crucially it only touches the named lines; the rest of the file is
 * preserved — so it cannot accidentally wipe a file the way a partial
 * write_file can.
 */
class ReplaceLinesTool implements vscode.LanguageModelTool<ReplaceLinesInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReplaceLinesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, newText } = options.input;
    const startLine = Math.floor(options.input.startLine);
    const endLine = Math.floor(options.input.endLine);
    const uri = resolveWorkspacePath(rel);
    const manager = getEditManager();

    const original = manager
      ? await manager.getEffectiveContent(uri)
      : new TextDecoder('utf-8').decode(
          await vscode.workspace.fs.readFile(uri)
        );

    // Preserve the file's newline style and trailing-newline.
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const hadTrailingNewline = /\r?\n$/.test(original);
    const lines = original.split(/\r?\n/);
    if (hadTrailingNewline && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const total = lines.length;

    if (startLine < 1 || startLine > total) {
      throw new Error(
        `replace_lines: startLine ${startLine} is out of range for ${rel} ` +
          `(file has ${total} lines). Read the file first to get valid line numbers.`
      );
    }
    if (endLine < startLine || endLine > total) {
      throw new Error(
        `replace_lines: endLine ${endLine} is invalid (startLine=${startLine}, ` +
          `file has ${total} lines).`
      );
    }

    // Split newText into lines (strip a single trailing newline if present).
    const replacement = newText.replace(/\r?\n$/, '').split(/\r?\n/);

    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const merged = [...before, ...replacement, ...after];
    let updated = merged.join(eol);
    if (hadTrailingNewline) {
      updated += eol;
    }

    const removedCount = endLine - startLine + 1;
    this.logger.debug(
      `replace_lines: ${rel} lines ${startLine}-${endLine} ` +
        `(${removedCount} → ${replacement.length} lines)`
    );

    if (manager) {
      const edit = await manager.stageModify(uri, updated);
      return textResult(
        `Staged replacement of lines ${startLine}-${endLine} in '${rel}' ` +
          `(${removedCount} line(s) → ${replacement.length} line(s); ` +
          `file net +${edit.added}/-${edit.removed}). Shown as a reviewable ` +
          `diff — not applied yet. The rest of the file is preserved.`
      );
    }

    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(updated)
    );
    return textResult(
      `Replaced lines ${startLine}-${endLine} in ${rel}.`
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ReplaceLinesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage:
        `Staging edit to \`${options.input.path}\` ` +
        `lines ${options.input.startLine}-${options.input.endLine}`,
    };
  }
}

export const replaceLinesTool: ToolDefinition<ReplaceLinesInput> = {
  descriptor: {
    llmName: 'replace_lines',
    vsCodeName: 'bosch_copilot_replace_lines',
    description:
      'Replace an inclusive 1-based line range [startLine..endLine] of a file ' +
      'with newText. This is the MOST RELIABLE way to edit existing code: it ' +
      'edits exactly those lines (no text matching, so no whitespace/quote ' +
      'mismatch) and preserves the rest of the file. First call read_file_range ' +
      'or document_outline to get the correct line numbers, then replace_lines. ' +
      'Staged for diff review. Prefer this over apply_diff for multi-line edits.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative file path.',
        },
        startLine: {
          type: 'number',
          description: 'First line to replace (1-based, inclusive).',
        },
        endLine: {
          type: 'number',
          description: 'Last line to replace (1-based, inclusive).',
        },
        newText: {
          type: 'string',
          description:
            'The new text for those lines (without surrounding lines). May be ' +
            'multiple lines; use an empty string to delete the range.',
        },
      },
      required: ['path', 'startLine', 'endLine', 'newText'],
    },
    destructive: true,
  },
  factory: (logger) => new ReplaceLinesTool(logger),
};
