import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { textResult, truncateForModel, symbolKindLabel } from './util';

interface FindSymbolInput {
  query: string;
  maxResults?: number;
}

class FindSymbolTool implements vscode.LanguageModelTool<FindSymbolInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<FindSymbolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const query = (options.input.query ?? '').trim();
    if (query.length === 0) {
      throw new Error('find_symbol: `query` must be non-empty.');
    }
    const maxResults = Math.min(
      Math.max(options.input.maxResults ?? 50, 1),
      200
    );

    this.logger.debug(`find_symbol: query='${query}'`);
    const symbols =
      (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query
      )) ?? [];

    if (symbols.length === 0) {
      this.logger.debug('find_symbol: no symbols (or no language server)');
      return textResult(
        `No workspace symbols matched "${query}". ` +
          'Note: this relies on the language extension for the relevant ' +
          'language being installed and active (TypeScript/JavaScript work ' +
          'out of the box). For plain-text matching use grep_workspace.'
      );
    }

    const rows = symbols.slice(0, maxResults).map((s) => {
      const rel = vscode.workspace.asRelativePath(s.location.uri);
      const line = s.location.range.start.line + 1;
      const container = s.containerName ? ` (in ${s.containerName})` : '';
      return `${symbolKindLabel(s.kind)} ${s.name}${container} — ${rel}:${line}`;
    });

    const more =
      symbols.length > maxResults
        ? `\n…(+${symbols.length - maxResults} more)`
        : '';
    this.logger.debug(`find_symbol: ${symbols.length} match(es)`);
    return textResult(
      truncateForModel(
        `Symbols matching "${query}" (${symbols.length}):\n\n` +
          rows.join('\n') +
          more
      )
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<FindSymbolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Finding symbol \`${options.input.query}\``,
    };
  }
}

export const findSymbolTool: ToolDefinition<FindSymbolInput> = {
  descriptor: {
    llmName: 'find_symbol',
    vsCodeName: 'bosch_copilot_find_symbol',
    description:
      'Find where a symbol (class, function, method, interface, variable) is ' +
      'DEFINED anywhere in the workspace, by name, using the language ' +
      "server's index. Returns 'kind name — path:line' rows. Best first step " +
      'for "where is X defined / implemented". Requires the relevant language ' +
      'extension to be active (TS/JS built-in).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Symbol name or fragment to search for, e.g. "AgentLoop".',
        },
        maxResults: {
          type: 'number',
          description: 'Max symbols to return (1-200, default 50).',
        },
      },
      required: ['query'],
    },
    destructive: false,
  },
  factory: (logger) => new FindSymbolTool(logger),
};
