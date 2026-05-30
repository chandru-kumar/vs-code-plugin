import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import {
  resolveWorkspacePath,
  textResult,
  truncateForModel,
  findSymbolPosition,
  describeLocations,
} from './util';

interface FindReferencesInput {
  path: string;
  symbol: string;
  line?: number;
}

class FindReferencesTool
  implements vscode.LanguageModelTool<FindReferencesInput>
{
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<FindReferencesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, symbol, line } = options.input;
    if (!symbol || symbol.trim().length === 0) {
      throw new Error('find_references: `symbol` must be non-empty.');
    }
    const uri = resolveWorkspacePath(rel);

    const { position } = await findSymbolPosition(uri, symbol, line);
    this.logger.debug(
      `find_references: ${rel} symbol='${symbol}' at ` +
        `${position.line + 1}:${position.character + 1}`
    );

    const locations =
      (await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position
      )) ?? [];

    this.logger.debug(`find_references: ${locations.length} reference(s)`);
    const body = await describeLocations(locations);
    return textResult(
      truncateForModel(
        `References to '${symbol}' (defined near ${rel}:${position.line + 1}) ` +
          `— ${locations.length} found:\n\n${body}`
      )
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<FindReferencesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Finding references to \`${options.input.symbol}\``,
    };
  }
}

export const findReferencesTool: ToolDefinition<FindReferencesInput> = {
  descriptor: {
    llmName: 'find_references',
    vsCodeName: 'bosch_copilot_find_references',
    description:
      'Find ALL USAGES (references) of a symbol across the workspace using the ' +
      'language server — i.e. everywhere a function/class/variable is called or ' +
      'used. Give the file `path` where the symbol appears and its `symbol` ' +
      'name (optionally a `line` to disambiguate). Returns path:line:col rows ' +
      'with snippets. Use this to trace code flow. Requires the relevant ' +
      'language extension (TS/JS built-in).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative file path containing an occurrence of the symbol.',
        },
        symbol: {
          type: 'string',
          description: 'The exact symbol name, e.g. "AgentLoop" or "run".',
        },
        line: {
          type: 'number',
          description:
            'Optional 1-based line in `path` where the symbol appears, to ' +
            'disambiguate when the name occurs multiple times.',
        },
      },
      required: ['path', 'symbol'],
    },
    destructive: false,
  },
  factory: (logger) => new FindReferencesTool(logger),
};
