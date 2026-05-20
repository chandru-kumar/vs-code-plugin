import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolves a workspace-relative path to an absolute URI, rejecting
 * traversal attempts and absolute paths. Throws a clear error if the
 * resulting URI would escape the workspace folder.
 */
export function resolveWorkspacePath(rel: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    throw new Error('No workspace open — cannot resolve a workspace path.');
  }
  const trimmed = rel.trim();
  if (trimmed.length === 0) {
    throw new Error('Empty path.');
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error(
      `Path must be workspace-relative (got absolute path: '${trimmed}').`
    );
  }
  // Normalize using posix so we get '..' detection regardless of OS.
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
  if (normalized.startsWith('..') || normalized === '..') {
    throw new Error(
      `Path escapes the workspace folder: '${rel}'.`
    );
  }
  return vscode.Uri.joinPath(ws.uri, normalized);
}

/**
 * Truncate a tool result to a reasonable size for the model. Local Qwen
 * has a finite context window; flooding it with a 500 KB file blows up
 * the conversation. Callers should also chunk large content semantically.
 */
export function truncateForModel(
  text: string,
  maxChars = 16_000
): string {
  if (text.length <= maxChars) {
    return text;
  }
  const keep = Math.floor(maxChars * 0.9);
  return (
    text.slice(0, keep) +
    `\n\n…[truncated ${text.length - keep} of ${text.length} characters]…\n`
  );
}

/**
 * Wraps a `LanguageModelToolResult` from a plain string. The single most
 * common shape for our tools.
 */
export function textResult(content: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(content),
  ]);
}
