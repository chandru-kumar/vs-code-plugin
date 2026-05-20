import * as vscode from 'vscode';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';

interface ListDirectoryInput {
  path: string;
}

const TYPE_LABEL: Record<vscode.FileType, string> = {
  [vscode.FileType.Unknown]: '?',
  [vscode.FileType.File]: 'F',
  [vscode.FileType.Directory]: 'D',
  [vscode.FileType.SymbolicLink]: 'L',
  // Composite types (e.g. File | SymbolicLink) — best-effort.
  [vscode.FileType.File | vscode.FileType.SymbolicLink]: 'F→',
  [vscode.FileType.Directory | vscode.FileType.SymbolicLink]: 'D→',
};

class ListDirectoryTool
  implements vscode.LanguageModelTool<ListDirectoryInput>
{
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListDirectoryInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const rel = options.input.path === '' ? '.' : options.input.path;
    const uri = resolveWorkspacePath(rel);
    const entries = await vscode.workspace.fs.readDirectory(uri);

    if (entries.length === 0) {
      return textResult(`(empty directory: ${rel})`);
    }
    entries.sort(([a], [b]) => a.localeCompare(b));
    const lines = entries.map(
      ([name, type]) => `${TYPE_LABEL[type] ?? '?'}\t${name}`
    );
    return textResult(
      `Directory: ${rel}\n` +
        `Legend: F=file, D=directory, L=symlink, →=link\n\n` +
        lines.join('\n')
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListDirectoryInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Listing \`${options.input.path || '.'}\``,
    };
  }
}

export const listDirectoryTool: ToolDefinition<ListDirectoryInput> = {
  descriptor: {
    llmName: 'list_directory',
    vsCodeName: 'pilotcode_list_directory',
    description:
      'List the immediate children of a workspace directory. ' +
      'Returns one line per entry with a type marker (F=file, D=directory). ' +
      'Use "." for the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative directory path. Use "." for the workspace root.',
        },
      },
      required: ['path'],
    },
    destructive: false,
  },
  factory: () => new ListDirectoryTool(),
};
