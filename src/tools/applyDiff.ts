import * as vscode from 'vscode';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';

interface ApplyDiffInput {
  path: string;
  /** The old text that must currently exist in the file (exact match). */
  oldText: string;
  /** The replacement text. */
  newText: string;
}

class ApplyDiffTool implements vscode.LanguageModelTool<ApplyDiffInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ApplyDiffInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, oldText, newText } = options.input;
    if (oldText === newText) {
      return textResult(`apply_diff: oldText and newText are identical — no change.`);
    }
    const uri = resolveWorkspacePath(rel);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const original = new TextDecoder('utf-8').decode(bytes);

    const occurrences = countOccurrences(original, oldText);
    if (occurrences === 0) {
      throw new Error(
        `apply_diff: oldText not found in ${rel}. ` +
          'The oldText must match EXACTLY (including whitespace and indentation).'
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `apply_diff: oldText matched ${occurrences} times in ${rel}. ` +
          'Provide a larger surrounding context so the match is unique.'
      );
    }

    const updated = original.replace(oldText, newText);
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
    const { path: rel, oldText, newText } = options.input;
    const oldPreview = preview(oldText);
    const newPreview = preview(newText);
    return {
      invocationMessage: `Patching \`${rel}\``,
      confirmationMessages: {
        title: 'Apply patch?',
        message: new vscode.MarkdownString(
          `Patch \`${rel}\`:\n\n` +
            `**− Remove (${oldText.length} chars):**\n` +
            '```\n' + oldPreview + '\n```\n\n' +
            `**+ Insert (${newText.length} chars):**\n` +
            '```\n' + newPreview + '\n```'
        ),
      },
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

function preview(text: string, max = 600): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '\n…';
}

export const applyDiffTool: ToolDefinition<ApplyDiffInput> = {
  descriptor: {
    llmName: 'apply_diff',
    vsCodeName: 'pilotcode_apply_diff',
    description:
      'Replace a unique exact substring in a workspace file. The `oldText` ' +
      'MUST appear exactly once in the file (provide enough surrounding ' +
      'context to make it unique). Always asks the user for confirmation. ' +
      'Use this instead of write_file for targeted edits — it preserves the ' +
      'rest of the file untouched.',
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
  factory: () => new ApplyDiffTool(),
};
