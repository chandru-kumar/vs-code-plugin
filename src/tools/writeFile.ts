import * as vscode from 'vscode';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';

interface WriteFileInput {
  path: string;
  content: string;
  /** If true, only create when the file does not already exist. */
  createOnly?: boolean;
}

class WriteFileTool implements vscode.LanguageModelTool<WriteFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<WriteFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, content, createOnly } = options.input;
    const uri = resolveWorkspacePath(rel);

    if (createOnly) {
      try {
        await vscode.workspace.fs.stat(uri);
        throw new Error(`write_file: file already exists: ${rel}`);
      } catch (err) {
        if ((err as { code?: string }).code !== 'FileNotFound') {
          // stat threw for non-not-found reasons OR our "already exists" — rethrow.
          if (
            err instanceof Error &&
            err.message.startsWith('write_file:')
          ) {
            throw err;
          }
          // Otherwise: file does not exist → fall through to write.
        }
      }
    }

    // Ensure parent directory exists.
    const parent = vscode.Uri.joinPath(uri, '..');
    try {
      await vscode.workspace.fs.createDirectory(parent);
    } catch {
      // already exists or workspace fs handled it
    }

    const bytes = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return textResult(`Wrote ${content.length} chars to ${rel}.`);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<WriteFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { path: rel, content, createOnly } = options.input;
    const preview = content.length > 800 ? content.slice(0, 800) + '\n…' : content;
    return {
      invocationMessage: `Writing \`${rel}\``,
      confirmationMessages: {
        title: createOnly ? 'Create file?' : 'Write file?',
        message: new vscode.MarkdownString(
          `${createOnly ? '**Create**' : '**Write**'} ` +
            `\`${rel}\` (${content.length} chars).\n\n` +
            '```\n' +
            preview +
            '\n```'
        ),
      },
    };
  }
}

export const writeFileTool: ToolDefinition<WriteFileInput> = {
  descriptor: {
    llmName: 'write_file',
    vsCodeName: 'bosch_copilot_write_file',
    description:
      'Write text content to a workspace-relative file. Overwrites by default; ' +
      'set `createOnly: true` to fail if the file already exists. ' +
      'Always asks the user for confirmation before writing. ' +
      'Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to write (e.g. "src/new.ts").',
        },
        content: {
          type: 'string',
          description: 'Full file contents to write (UTF-8).',
        },
        createOnly: {
          type: 'boolean',
          description: 'If true, fail when the file already exists.',
        },
      },
      required: ['path', 'content'],
    },
    destructive: true,
  },
  factory: () => new WriteFileTool(),
};
