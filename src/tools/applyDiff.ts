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

    const occurrences = countOccurrences(original, oldText);
    if (occurrences === 0) {
      throw new Error(
        `apply_diff: oldText not found in ${rel}. ` +
          'The oldText must match EXACTLY (including whitespace and indentation). ' +
          'Read the file first to copy the exact text.'
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `apply_diff: oldText matched ${occurrences} times in ${rel}. ` +
          'Provide a larger surrounding context so the match is unique.'
      );
    }

    const updated = original.replace(oldText, newText);

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

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

export const applyDiffTool: ToolDefinition<ApplyDiffInput> = {
  descriptor: {
    llmName: 'apply_diff',
    vsCodeName: 'bosch_copilot_apply_diff',
    description:
      'Replace a unique exact substring in a workspace file. The `oldText` ' +
      'MUST appear exactly once in the file (provide enough surrounding ' +
      'context to make it unique). The change is STAGED and shown to the user ' +
      'as a reviewable red/green diff to Apply or Discard. Preferred for ' +
      'targeted edits — it preserves the rest of the file untouched. You can ' +
      'stage multiple edits (same or different files) before the user reviews.',
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
