import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import {
  resolveWorkspacePath,
  textResult,
  truncateForModel,
  symbolKindLabel,
} from './util';

interface DocumentOutlineInput {
  path: string;
}

class DocumentOutlineTool
  implements vscode.LanguageModelTool<DocumentOutlineInput>
{
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DocumentOutlineInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: rel } = options.input;
    const uri = resolveWorkspacePath(rel);
    // Ensure the document is loaded so the symbol provider can analyse it.
    await vscode.workspace.openTextDocument(uri);

    this.logger.debug(`document_outline: ${rel}`);
    const symbols =
      (await vscode.commands.executeCommand<
        Array<vscode.DocumentSymbol | vscode.SymbolInformation>
      >('vscode.executeDocumentSymbolProvider', uri)) ?? [];

    if (symbols.length === 0) {
      this.logger.debug('document_outline: no symbols (or no language server)');
      return textResult(
        `No symbols found in ${rel}. The file may be empty, or the language ` +
          'extension for this file type is not installed/active.'
      );
    }

    const lines: string[] = [];
    if (isDocumentSymbolArray(symbols)) {
      for (const s of symbols) {
        renderDocumentSymbol(s, 0, lines);
      }
    } else {
      for (const s of symbols as vscode.SymbolInformation[]) {
        const line = s.location.range.start.line + 1;
        lines.push(`${symbolKindLabel(s.kind)} ${s.name} — line ${line}`);
      }
    }

    this.logger.debug(`document_outline: ${lines.length} symbol line(s)`);
    return textResult(
      truncateForModel(`Outline of ${rel}:\n\n${lines.join('\n')}`)
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<DocumentOutlineInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Outlining \`${options.input.path}\``,
    };
  }
}

function isDocumentSymbolArray(
  arr: Array<vscode.DocumentSymbol | vscode.SymbolInformation>
): arr is vscode.DocumentSymbol[] {
  return arr.length > 0 && (arr[0] as vscode.DocumentSymbol).children !== undefined;
}

function renderDocumentSymbol(
  sym: vscode.DocumentSymbol,
  depth: number,
  out: string[]
): void {
  const indent = '  '.repeat(depth);
  const startLine = sym.range.start.line + 1;
  const endLine = sym.range.end.line + 1;
  out.push(
    `${indent}${symbolKindLabel(sym.kind)} ${sym.name} — lines ${startLine}-${endLine}`
  );
  for (const child of sym.children) {
    renderDocumentSymbol(child, depth + 1, out);
  }
}

export const documentOutlineTool: ToolDefinition<DocumentOutlineInput> = {
  descriptor: {
    llmName: 'document_outline',
    vsCodeName: 'bosch_copilot_document_outline',
    description:
      'List the structural symbols (classes, methods, functions, fields) of a ' +
      'single file as an indented outline with line ranges, using the ' +
      'language server. Great for understanding a file’s shape before reading ' +
      'it in full. Requires the relevant language extension (TS/JS built-in).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative file path to outline.',
        },
      },
      required: ['path'],
    },
    destructive: false,
  },
  factory: (logger) => new DocumentOutlineTool(logger),
};
