import * as vscode from 'vscode';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult, truncateForModel } from './util';

interface ReadFileInput {
  path: string;
}

class ReadFileTool implements vscode.LanguageModelTool<ReadFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReadFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const uri = resolveWorkspacePath(options.input.path);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder('utf-8').decode(bytes);
    return textResult(truncateForModel(text));
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ReadFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Reading \`${options.input.path}\``,
      // No confirmation: read is non-destructive.
    };
  }
}

export const readFileTool: ToolDefinition<ReadFileInput> = {
  descriptor: {
    llmName: 'read_file',
    vsCodeName: 'pilotcode_read_file',
    description:
      'Read the contents of a workspace-relative file and return the full UTF-8 text. ' +
      'Path must be relative to the workspace root (e.g. "src/app.ts"). ' +
      'Large files are truncated.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path to the file (forward slashes), e.g. "src/app.ts".',
        },
      },
      required: ['path'],
    },
    destructive: false,
  },
  factory: () => new ReadFileTool(),
};
