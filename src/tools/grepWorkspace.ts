import * as vscode from 'vscode';
import type { ToolDefinition } from '../agent/types';
import { textResult, truncateForModel } from './util';

interface GrepWorkspaceInput {
  query: string;
  glob?: string;
  /** Optional max number of matches to return (default 50). */
  maxResults?: number;
}

const DEFAULT_EXCLUDE =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**,**/build/**,**/.venv/**,**/__pycache__/**}';

class GrepWorkspaceTool
  implements vscode.LanguageModelTool<GrepWorkspaceInput>
{
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GrepWorkspaceInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { query } = options.input;
    if (!query || query.trim().length === 0) {
      throw new Error('grep_workspace: `query` must be non-empty.');
    }

    const glob = options.input.glob ?? '**/*';
    const maxResults = Math.min(Math.max(options.input.maxResults ?? 50, 1), 200);

    // Treat query as a literal substring (no regex surprises for the LLM).
    const needle = query;

    const uris = await vscode.workspace.findFiles(
      glob,
      DEFAULT_EXCLUDE,
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
        if (lines[i].includes(needle)) {
          matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }
    }

    const header =
      `Query: "${query}" (glob: ${glob}). ` +
      `Scanned ${scanned} files, found ${matches.length} match(es)` +
      (matches.length >= maxResults ? ` (capped at ${maxResults})` : '') +
      '.\n\n';

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
    vsCodeName: 'pilotcode_grep_workspace',
    description:
      'Search the workspace for a literal substring across files. Returns ' +
      '"path:line: matched text" rows. Optional `glob` to scope the search ' +
      '(default `**/*`). Optional `maxResults` (default 50). Skips ' +
      'node_modules, .git, dist, out, build, .venv, __pycache__ by default.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Literal substring to search for (NOT a regex).',
        },
        glob: {
          type: 'string',
          description: 'Optional include glob, e.g. "src/**/*.ts".',
        },
        maxResults: {
          type: 'number',
          description: 'Max number of matches to return (1-200, default 50).',
        },
      },
      required: ['query'],
    },
    destructive: false,
  },
  factory: () => new GrepWorkspaceTool(),
};
