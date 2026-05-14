import * as vscode from 'vscode';

/**
 * The slice of the document we send to the model for an inline completion.
 * `prefix` is everything before the cursor, `suffix` everything after.
 */
export interface CompletionContext {
  prefix: string;
  suffix: string;
  languageId: string;
  fileName: string;
}

/**
 * Builds the prefix/suffix context window around the cursor, bounded both
 * by a line count (per side) and a hard character budget. When the budget
 * is exceeded, text *closest to the cursor* is kept.
 */
export function gatherContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  prefixLines: number,
  suffixLines: number,
  maxChars: number
): CompletionContext {
  const startLine = Math.max(0, position.line - prefixLines);
  const endLine = Math.min(
    document.lineCount - 1,
    position.line + suffixLines
  );

  const prefixRange = new vscode.Range(
    new vscode.Position(startLine, 0),
    position
  );
  const lastLineLength = document.lineAt(endLine).text.length;
  const suffixRange = new vscode.Range(
    position,
    new vscode.Position(endLine, lastLineLength)
  );

  let prefix = document.getText(prefixRange);
  let suffix = document.getText(suffixRange);

  // Give the prefix the larger share of the budget — what comes *before*
  // the cursor matters most for a good completion.
  const prefixBudget = Math.floor(maxChars * 0.67);
  const suffixBudget = maxChars - prefixBudget;
  if (prefix.length > prefixBudget) {
    prefix = prefix.slice(prefix.length - prefixBudget);
  }
  if (suffix.length > suffixBudget) {
    suffix = suffix.slice(0, suffixBudget);
  }

  return {
    prefix,
    suffix,
    languageId: document.languageId,
    fileName: vscode.workspace.asRelativePath(document.uri),
  };
}
