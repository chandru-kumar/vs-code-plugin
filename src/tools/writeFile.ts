import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { resolveWorkspacePath, textResult } from './util';
import { getEditManager } from '../agent/editManager';

interface WriteFileInput {
  path: string;
  content: string;
  /**
   * Must be `true` to replace an EXISTING file's entire contents. Default
   * false — protects against accidentally wiping a file by passing partial
   * content. To edit part of an existing file use apply_diff / replace_lines.
   */
  overwrite?: boolean;
}

class WriteFileTool implements vscode.LanguageModelTool<WriteFileInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<WriteFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, content } = options.input;
    const overwrite = options.input.overwrite === true;
    const uri = resolveWorkspacePath(rel);
    const manager = getEditManager();

    // Is this file already present (on disk OR already staged this turn)?
    const existsOnDisk = await fileExists(uri);
    const existsStaged = manager
      ? manager.getStaged().some((e) => e.relPath === rel)
      : false;
    const exists = existsOnDisk || existsStaged;

    // GUARD: never silently replace a whole existing file. A weak model that
    // passes a fragment as `content` would otherwise wipe the rest of the
    // file. Require an explicit `overwrite: true`.
    if (exists && !overwrite) {
      throw new Error(
        `write_file: '${rel}' already exists. write_file would replace the ` +
          `ENTIRE file. To change PART of it, use replace_lines (by line ` +
          `range) or apply_diff (by exact text) — these preserve the rest of ` +
          `the file. Only if you intend to replace the whole file, call ` +
          `write_file again with overwrite: true and the COMPLETE new content.`
      );
    }

    // Preferred path: STAGE the change for the user to review as a diff.
    if (manager) {
      const edit = await manager.stageCreate(uri, content);
      // Extra safety net: warn (in the result to the model) on a big shrink.
      const shrinkNote =
        edit.kind === 'modify' && edit.removed > edit.added + 50
          ? ` WARNING: this removes ${edit.removed} lines — make sure you ` +
            `included the COMPLETE file content, not just a fragment.`
          : '';
      this.logger.debug(
        `write_file: staged ${edit.kind} ${rel} (${content.length} chars, ` +
          `+${edit.added}/-${edit.removed})`
      );
      return textResult(
        `Staged ${edit.kind === 'create' ? 'new file' : 'full overwrite of'} ` +
          `'${rel}' (${content.length} chars, +${edit.added}/-${edit.removed}). ` +
          `Shown to the user as a reviewable diff — not applied yet.${shrinkNote}`
      );
    }

    // Fallback (invoked via #write_file outside an agent turn): write to disk.
    const parent = vscode.Uri.joinPath(uri, '..');
    try {
      await vscode.workspace.fs.createDirectory(parent);
    } catch {
      /* already exists */
    }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
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
      'Create a NEW file with full content (the change is staged for diff ' +
      'review). For an EXISTING file this fails unless you pass ' +
      'overwrite:true AND the COMPLETE new file content — passing a fragment ' +
      'would wipe the rest of the file. To change PART of an existing file, ' +
      'use replace_lines (line range) or apply_diff (exact text) instead.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to write (e.g. "src/new.ts").',
        },
        content: {
          type: 'string',
          description:
            'Full file contents (UTF-8). For an existing file this MUST be ' +
            'the entire file, not a fragment.',
        },
        overwrite: {
          type: 'boolean',
          description:
            'Required (true) to replace an existing file entirely. Default false.',
        },
      },
      required: ['path', 'content'],
    },
    destructive: true,
  },
  factory: (logger) => new WriteFileTool(logger),
};
