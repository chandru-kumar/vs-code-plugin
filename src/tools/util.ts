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

// ---------------------------------------------------------------------------
// Helpers shared by the code-navigation tools (find_references, etc.)
// ---------------------------------------------------------------------------

/** Default glob excludes for workspace-wide file scans. */
export const DEFAULT_EXCLUDE_GLOB =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**,**/build/**,**/.venv/**,**/__pycache__/**,**/.gradle/**,**/target/**,**/bin/**,**/obj/**}';

/**
 * Open the document at `uri` and locate the position of `symbol`.
 *
 * - If `line` (1-based) is provided, only that line is searched.
 * - Otherwise the first occurrence in the whole file is used.
 * The returned position points at the *start* of the symbol token, which
 * is what the reference / definition providers expect.
 *
 * Throws a clear, model-readable error if the symbol cannot be found.
 */
export async function findSymbolPosition(
  uri: vscode.Uri,
  symbol: string,
  line?: number
): Promise<{ doc: vscode.TextDocument; position: vscode.Position }> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const rel = vscode.workspace.asRelativePath(uri);

  if (line !== undefined) {
    const idx = line - 1;
    if (idx < 0 || idx >= doc.lineCount) {
      throw new Error(
        `Line ${line} is out of range for ${rel} (1-${doc.lineCount}).`
      );
    }
    const col = doc.lineAt(idx).text.indexOf(symbol);
    if (col < 0) {
      throw new Error(
        `Symbol '${symbol}' not found on line ${line} of ${rel}.`
      );
    }
    return { doc, position: new vscode.Position(idx, col) };
  }

  const text = doc.getText();
  const offset = text.indexOf(symbol);
  if (offset < 0) {
    throw new Error(
      `Symbol '${symbol}' not found anywhere in ${rel}. ` +
        `Check the spelling, or pass an explicit 'line'.`
    );
  }
  return { doc, position: doc.positionAt(offset) };
}

/**
 * Render a list of `Location`s (or `LocationLink`s) as `path:line:col` rows
 * with a trimmed snippet of the referenced line. Opens each target document
 * (cached) to fetch the snippet. Caps output at `max` rows.
 */
export async function describeLocations(
  locations: ReadonlyArray<vscode.Location | vscode.LocationLink>,
  max = 100
): Promise<string> {
  if (locations.length === 0) {
    return '(no results)';
  }
  const docCache = new Map<string, vscode.TextDocument>();
  const rows: string[] = [];

  for (const loc of locations.slice(0, max)) {
    const uri = isLocationLink(loc) ? loc.targetUri : loc.uri;
    const range = isLocationLink(loc) ? loc.targetRange : loc.range;
    const key = uri.toString();
    let doc = docCache.get(key);
    if (!doc) {
      try {
        doc = await vscode.workspace.openTextDocument(uri);
        docCache.set(key, doc);
      } catch {
        doc = undefined;
      }
    }
    const rel = vscode.workspace.asRelativePath(uri);
    const lineNo = range.start.line + 1;
    const colNo = range.start.character + 1;
    const snippet = doc
      ? doc.lineAt(range.start.line).text.trim().slice(0, 160)
      : '';
    rows.push(`${rel}:${lineNo}:${colNo}${snippet ? `  ${snippet}` : ''}`);
  }

  const more =
    locations.length > max ? `\n…(+${locations.length - max} more)` : '';
  return rows.join('\n') + more;
}

function isLocationLink(
  loc: vscode.Location | vscode.LocationLink
): loc is vscode.LocationLink {
  return (loc as vscode.LocationLink).targetUri !== undefined;
}

/** Human-readable label for a SymbolKind. */
export function symbolKindLabel(kind: vscode.SymbolKind): string {
  // vscode.SymbolKind is a numeric enum; this maps the common ones.
  const map: Partial<Record<vscode.SymbolKind, string>> = {
    [vscode.SymbolKind.File]: 'file',
    [vscode.SymbolKind.Module]: 'module',
    [vscode.SymbolKind.Namespace]: 'namespace',
    [vscode.SymbolKind.Package]: 'package',
    [vscode.SymbolKind.Class]: 'class',
    [vscode.SymbolKind.Method]: 'method',
    [vscode.SymbolKind.Property]: 'property',
    [vscode.SymbolKind.Field]: 'field',
    [vscode.SymbolKind.Constructor]: 'constructor',
    [vscode.SymbolKind.Enum]: 'enum',
    [vscode.SymbolKind.Interface]: 'interface',
    [vscode.SymbolKind.Function]: 'function',
    [vscode.SymbolKind.Variable]: 'variable',
    [vscode.SymbolKind.Constant]: 'constant',
    [vscode.SymbolKind.String]: 'string',
    [vscode.SymbolKind.Number]: 'number',
    [vscode.SymbolKind.Boolean]: 'boolean',
    [vscode.SymbolKind.Array]: 'array',
    [vscode.SymbolKind.Object]: 'object',
    [vscode.SymbolKind.Key]: 'key',
    [vscode.SymbolKind.EnumMember]: 'enum-member',
    [vscode.SymbolKind.Struct]: 'struct',
    [vscode.SymbolKind.Event]: 'event',
    [vscode.SymbolKind.TypeParameter]: 'type-param',
  };
  return map[kind] ?? 'symbol';
}

/**
 * Render a slice of a document with 1-based line-number gutters, e.g.
 *   12 | const x = 1;
 *   13 | foo(x);
 */
export function numberedLines(
  doc: vscode.TextDocument,
  startLine0: number,
  endLine0: number
): string {
  const width = String(endLine0 + 1).length;
  const out: string[] = [];
  for (let i = startLine0; i <= endLine0; i++) {
    const n = String(i + 1).padStart(width, ' ');
    out.push(`${n} | ${doc.lineAt(i).text}`);
  }
  return out.join('\n');
}
