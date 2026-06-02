import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';
import { getEditManager } from '../agent/editManager';

interface WriteFileInput {
  path: string;
  content: string;
  /** If true, only create when the file does not already exist. */
  createOnly?: boolean;
}

class WriteFileTool implements vscode.LanguageModelTool<WriteFileInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<WriteFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, content, createOnly } = options.input;
    const uri = resolveWorkspacePath(rel);
    const manager = getEditManager();

    if (createOnly && (await fileExists(uri))) {
      throw new Error(`write_file: file already exists: ${rel}`);
    }

    // Preferred path: STAGE the change for the user to review as a diff.
    if (manager) {
      const edit = await manager.stageCreate(uri, content);
      this.logger.debug(`write_file: staged ${rel} (${content.length} chars)`);
      return textResult(
        `Staged ${edit.kind === 'create' ? 'new file' : 'overwrite'} ` +
          `'${rel}' (${content.length} chars, +${edit.added}/-${edit.removed}). ` +
          `It will be shown to the user as a reviewable diff — do NOT assume ` +
          `it is applied yet.`
      );
    }

    // Fallback (e.g. invoked via #write_file outside an agent turn):
    // write directly to disk.
    const parent = vscode.Uri.joinPath(uri, '..');
    try {
      await vscode.workspace.fs.createDirectory(parent);
    } catch {
      /* already exists */
    }
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(content)
    );
    return textResult(`Wrote ${content.length} chars to ${rel}.`);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<WriteFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    // No confirmation card: edits are staged and reviewed as a diff.
    return {
      invocationMessage: `Staging write to \`${options.input.path}\``,
    };
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export const writeFileTool: ToolDefinition<WriteFileInput> = {
  descriptor: {
    llmName: 'write_file',
    vsCodeName: 'bosch_copilot_write_file',
    description:
      'Create or overwrite a workspace file with full content. The change is ' +
      'STAGED (not written immediately) and shown to the user as a reviewable ' +
      'red/green diff to Apply or Discard. Set `createOnly: true` to fail if the ' +
      'file already exists. Use apply_diff instead for small edits to existing files.',
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
  factory: (logger) => new WriteFileTool(logger),
};
