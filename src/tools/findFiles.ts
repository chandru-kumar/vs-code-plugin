import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { textResult, truncateForModel, DEFAULT_EXCLUDE_GLOB } from './util';

interface FindFilesInput {
  glob: string;
  maxResults?: number;
}

class FindFilesTool implements vscode.LanguageModelTool<FindFilesInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<FindFilesInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const glob = (options.input.glob ?? '').trim();
    if (glob.length === 0) {
      throw new Error('find_files: `glob` must be non-empty, e.g. "**/*.ts".');
    }
    const maxResults = Math.min(
      Math.max(options.input.maxResults ?? 100, 1),
      500
    );

    this.logger.debug(`find_files: glob='${glob}' max=${maxResults}`);
    const uris = await vscode.workspace.findFiles(
      glob,
      DEFAULT_EXCLUDE_GLOB,
      maxResults,
      token
    );

    const rels = uris
      .map((u) => vscode.workspace.asRelativePath(u))
      .sort((a, b) => a.localeCompare(b));

    const header =
      `Glob: ${glob} — ${rels.length} file(s)` +
      (rels.length >= maxResults ? ` (capped at ${maxResults})` : '') +
      '.\n\n';
    this.logger.debug(`find_files: ${rels.length} match(es)`);
    return textResult(
      truncateForModel(header + (rels.join('\n') || '(no files matched)'))
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<FindFilesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Finding files \`${options.input.glob}\``,
    };
  }
}

export const findFilesTool: ToolDefinition<FindFilesInput> = {
  descriptor: {
    llmName: 'find_files',
    vsCodeName: 'bosch_copilot_find_files',
    description:
      'Find files in the workspace by GLOB PATTERN against their path/name ' +
      '(this searches file NAMES, not file contents — use grep_workspace for ' +
      'content). Examples: "**/*.ts", "src/**/test_*.py", "**/package.json". ' +
      'Returns matching workspace-relative paths. Skips node_modules, dist, ' +
      'build, target, etc. by default.',
    parameters: {
      type: 'object',
      properties: {
        glob: {
          type: 'string',
          description:
            'A glob pattern matched against file paths, e.g. "src/**/*.ts".',
        },
        maxResults: {
          type: 'number',
          description: 'Max number of files to return (1-500, default 100).',
        },
      },
      required: ['glob'],
    },
    destructive: false,
  },
  factory: (logger) => new FindFilesTool(logger),
};
