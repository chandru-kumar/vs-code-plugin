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

interface GoToDefinitionInput {
  path: string;
  symbol: string;
  line?: number;
}

class GoToDefinitionTool
  implements vscode.LanguageModelTool<GoToDefinitionInput>
{
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GoToDefinitionInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel, symbol, line } = options.input;
    if (!symbol || symbol.trim().length === 0) {
      throw new Error('go_to_definition: `symbol` must be non-empty.');
    }
    const uri = resolveWorkspacePath(rel);

    const { position } = await findSymbolPosition(uri, symbol, line);
    this.logger.debug(
      `go_to_definition: ${rel} symbol='${symbol}' at ` +
        `${position.line + 1}:${position.character + 1}`
    );

    const defs =
      (await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >('vscode.executeDefinitionProvider', uri, position)) ?? [];

    this.logger.debug(`go_to_definition: ${defs.length} definition(s)`);
    const body = await describeLocations(defs, 20);
    return textResult(
      truncateForModel(
        `Definition(s) of '${symbol}' — ${defs.length} found:\n\n${body}`
      )
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GoToDefinitionInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Locating definition of \`${options.input.symbol}\``,
    };
  }
}

export const goToDefinitionTool: ToolDefinition<GoToDefinitionInput> = {
  descriptor: {
    llmName: 'go_to_definition',
    vsCodeName: 'bosch_copilot_go_to_definition',
    description:
      'Jump to where a symbol is DEFINED, starting from a usage of it. Give ' +
      'the file `path` where the symbol is used and its `symbol` name ' +
      '(optionally a `line`). Returns the definition location(s) with a ' +
      'snippet. The inverse of find_references. Requires the relevant ' +
      'language extension (TS/JS built-in).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative file path containing a usage of the symbol.',
        },
        symbol: {
          type: 'string',
          description: 'The exact symbol name to resolve.',
        },
        line: {
          type: 'number',
          description:
            'Optional 1-based line in `path` where the symbol is used, to ' +
            'disambiguate.',
        },
      },
      required: ['path', 'symbol'],
    },
    destructive: false,
  },
  factory: (logger) => new GoToDefinitionTool(logger),
};
