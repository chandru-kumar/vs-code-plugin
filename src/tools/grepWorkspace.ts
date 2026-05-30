import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { textResult, truncateForModel, DEFAULT_EXCLUDE_GLOB } from './util';

interface GrepWorkspaceInput {
  query: string;
  glob?: string;
  /** Optional max number of matches to return (default 50). */
  maxResults?: number;
  /** Treat `query` as a JavaScript regular expression instead of a literal. */
  isRegex?: boolean;
  /** Case-insensitive matching (default false). */
  caseInsensitive?: boolean;
}

class GrepWorkspaceTool
  implements vscode.LanguageModelTool<GrepWorkspaceInput>
{
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GrepWorkspaceInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { query } = options.input;
    if (!query || query.trim().length === 0) {
      throw new Error('grep_workspace: `query` must be non-empty.');
    }

    const glob = options.input.glob ?? '**/*';
    const maxResults = Math.min(
      Math.max(options.input.maxResults ?? 50, 1),
      200
    );
    const isRegex = options.input.isRegex === true;
    const caseInsensitive = options.input.caseInsensitive === true;

    // Build the matcher: literal substring (default) or regex.
    let regex: RegExp | undefined;
    if (isRegex) {
      try {
        regex = new RegExp(query, caseInsensitive ? 'i' : '');
      } catch (e) {
        throw new Error(
          `grep_workspace: invalid regular expression — ${(e as Error).message}`
        );
      }
    }
    const needleLower = caseInsensitive ? query.toLowerCase() : query;

    const matchLine = (line: string): boolean => {
      if (regex) {
        return regex.test(line);
      }
      return caseInsensitive
        ? line.toLowerCase().includes(needleLower)
        : line.includes(query);
    };

    this.logger.debug(
      `grep_workspace: query='${query}' glob='${glob}' ` +
        `regex=${isRegex} ci=${caseInsensitive} max=${maxResults}`
    );

    const uris = await vscode.workspace.findFiles(
      glob,
      DEFAULT_EXCLUDE_GLOB,
      2_000,
      token
    );

    const matches: string[] = [];
    let scanned = 0;

    for (const uri of uris) {
      if (token.isCancellationRequested) {
        break;
      }
      if (matches.length >= maxResults) {
        break;
      }
      scanned++;
      let text: string;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        // Skip likely-binary files (presence of NUL byte in first 4 KB).
        if (bytes.subarray(0, 4096).includes(0)) {
          continue;
        }
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch {
        continue;
      }

      const lines = text.split(/\r?\n/);
      const rel = vscode.workspace.asRelativePath(uri);
      for (let i = 0; i < lines.length; i++) {
        if (matchLine(lines[i])) {
          matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }
    }

    const header =
      `Query: "${query}" (${isRegex ? 'regex' : 'literal'}` +
      `${caseInsensitive ? ', case-insensitive' : ''}, glob: ${glob}). ` +
      `Scanned ${scanned} files, found ${matches.length} match(es)` +
      (matches.length >= maxResults ? ` (capped at ${maxResults})` : '') +
      '.\n\n';

    this.logger.debug(
      `grep_workspace: scanned ${scanned} files, ${matches.length} match(es)`
    );
    return textResult(
      truncateForModel(header + (matches.join('\n') || '(no matches)'))
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GrepWorkspaceInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Searching workspace for \`${options.input.query}\``,
    };
  }
}

export const grepWorkspaceTool: ToolDefinition<GrepWorkspaceInput> = {
  descriptor: {
    llmName: 'grep_workspace',
    vsCodeName: 'bosch_copilot_grep_workspace',
    description:
      'Search the CONTENTS of workspace files for text (the textSearch tool). ' +
      'By default `query` is a literal substring; set `isRegex: true` to use a ' +
      'JavaScript regular expression. Returns "path:line: matched text" rows. ' +
      'Optional `glob` to scope (default `**/*`), `maxResults` (default 50), ' +
      '`caseInsensitive`. Skips node_modules, .git, dist, build, target, etc. ' +
      'To search file NAMES instead of contents, use find_files.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Text to search for. A literal substring unless isRegex is true.',
        },
        glob: {
          type: 'string',
          description: 'Optional include glob, e.g. "src/**/*.ts".',
        },
        maxResults: {
          type: 'number',
          description: 'Max number of matches to return (1-200, default 50).',
        },
        isRegex: {
          type: 'boolean',
          description:
            'Treat `query` as a JavaScript regular expression (default false).',
        },
        caseInsensitive: {
          type: 'boolean',
          description: 'Case-insensitive matching (default false).',
        },
      },
      required: ['query'],
    },
    destructive: false,
  },
  factory: (logger) => new GrepWorkspaceTool(logger),
};
