import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import {
  resolveWorkspacePath,
  textResult,
  truncateForModel,
  numberedLines,
} from './util';

interface ReadFileRangeInput {
  path: string;
  startLine: number;
  endLine: number;
}

class ReadFileRangeTool
  implements vscode.LanguageModelTool<ReadFileRangeInput>
{
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReadFileRangeInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel } = options.input;
    const uri = resolveWorkspacePath(rel);
    const doc = await vscode.workspace.openTextDocument(uri);

    const start0 = Math.max(0, Math.floor(options.input.startLine) - 1);
    const end0 = Math.min(
      doc.lineCount - 1,
      Math.floor(options.input.endLine) - 1
    );
    if (end0 < start0) {
      throw new Error(
        `read_file_range: endLine (${options.input.endLine}) is before ` +
          `startLine (${options.input.startLine}).`
      );
    }

    this.logger.debug(
      `read_file_range: ${rel} lines ${start0 + 1}-${end0 + 1} ` +
        `(file has ${doc.lineCount} lines)`
    );

    const header = `${rel} (lines ${start0 + 1}-${end0 + 1} of ${doc.lineCount}, ${doc.languageId}):\n\n`;
    return textResult(
      truncateForModel(header + numberedLines(doc, start0, end0))
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ReadFileRangeInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage:
        `Reading \`${options.input.path}\` ` +
        `lines ${options.input.startLine}-${options.input.endLine}`,
    };
  }
}

export const readFileRangeTool: ToolDefinition<ReadFileRangeInput> = {
  descriptor: {
    llmName: 'read_file_range',
    vsCodeName: 'bosch_copilot_read_file_range',
    description:
      'Read a specific 1-based inclusive line range of a workspace file, ' +
      'returned with line-number gutters. Prefer this over read_file when ' +
      'you only need part of a large file (e.g. after find_references told ' +
      'you the interesting line numbers).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative file path.',
        },
        startLine: {
          type: 'number',
          description: 'First line to read (1-based, inclusive).',
        },
        endLine: {
          type: 'number',
          description: 'Last line to read (1-based, inclusive).',
        },
      },
      required: ['path', 'startLine', 'endLine'],
    },
    destructive: false,
  },
  factory: (logger) => new ReadFileRangeTool(logger),
};
