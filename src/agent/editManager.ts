import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

/** URI scheme used to serve proposed (right-hand-side) diff content. */
export const PROPOSED_SCHEME = 'bosch-copilot-proposed';

export type EditKind = 'create' | 'modify';

export interface PendingEdit {
  id: string;
  uri: vscode.Uri;
  relPath: string;
  kind: EditKind;
  /** Original on-disk text ('' for newly-created files). */
  originalText: string;
  /** Proposed full file text after the edit. */
  newText: string;
  added: number;
  removed: number;
}

/**
 * Collects the edits an agent turn wants to make, WITHOUT writing to disk.
 * The user reviews them as native red/green diffs and then Apply / Discard.
 *
 * - `stageModify` / `stageCreate` accumulate edits for the current turn.
 *   Re-staging the same file merges (keeps the first original, takes the
 *   latest proposed text) so multi-step edits to one file are coherent.
 * - `getEffectiveContent` returns the staged text if present, else the
 *   on-disk text — so a second edit operates on the in-progress version.
 * - Serves the right-hand diff side via a `TextDocumentContentProvider`.
 *
 * One instance lives for the whole extension; it holds the *latest* turn's
 * pending edits until the user applies or discards them.
 */
export class EditManager
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly pending = new Map<string, PendingEdit>(); // id -> edit
  private readonly byPath = new Map<string, string>(); // relPath -> id
  private counter = 0;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly logger: Logger) {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        PROPOSED_SCHEME,
        this
      )
    );
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  // --- content provider --------------------------------------------------

  provideTextDocumentContent(uri: vscode.Uri): string {
    // uri = bosch-copilot-proposed://<authority>/<id>
    const id = uri.path.replace(/^\/+/, '');
    if (uri.authority === 'empty') {
      return '';
    }
    return this.pending.get(id)?.newText ?? '';
  }

  // --- turn lifecycle ----------------------------------------------------

  /**
   * Begin a fresh turn. Any unapplied edits from a previous turn are
   * dropped (the user moved on without applying them).
   */
  beginTurn(): void {
    if (this.pending.size > 0) {
      this.logger.debug(
        `editManager: dropping ${this.pending.size} unapplied edit(s) from previous turn`
      );
    }
    this.pending.clear();
    this.byPath.clear();
  }

  hasStaged(): boolean {
    return this.pending.size > 0;
  }

  getStaged(): PendingEdit[] {
    return [...this.pending.values()];
  }

  getById(id: string): PendingEdit | undefined {
    return this.pending.get(id);
  }

  // --- staging -----------------------------------------------------------

  /** Effective current content for a file: staged text if any, else disk. */
  async getEffectiveContent(uri: vscode.Uri): Promise<string> {
    const rel = vscode.workspace.asRelativePath(uri);
    const existingId = this.byPath.get(rel);
    if (existingId) {
      return this.pending.get(existingId)!.newText;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** Does a file exist on disk? */
  async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  async stageModify(uri: vscode.Uri, newText: string): Promise<PendingEdit> {
    const rel = vscode.workspace.asRelativePath(uri);
    const existingId = this.byPath.get(rel);
    let originalText: string;
    if (existingId) {
      originalText = this.pending.get(existingId)!.originalText;
    } else {
      const bytes = await vscode.workspace.fs.readFile(uri);
      originalText = new TextDecoder('utf-8').decode(bytes);
    }
    return this.upsert(uri, rel, 'modify', originalText, newText, existingId);
  }

  async stageCreate(uri: vscode.Uri, newText: string): Promise<PendingEdit> {
    const rel = vscode.workspace.asRelativePath(uri);
    const existingId = this.byPath.get(rel);
    // If the file already exists on disk, treat as modify so the diff is real.
    const exists = existingId ? false : await this.fileExists(uri);
    const kind: EditKind = exists ? 'modify' : 'create';
    const originalText = exists
      ? new TextDecoder('utf-8').decode(
          await vscode.workspace.fs.readFile(uri)
        )
      : '';
    return this.upsert(uri, rel, kind, originalText, newText, existingId);
  }

  private upsert(
    uri: vscode.Uri,
    rel: string,
    kind: EditKind,
    originalText: string,
    newText: string,
    existingId: string | undefined
  ): PendingEdit {
    const id = existingId ?? `e${++this.counter}`;
    const { added, removed } = diffStat(originalText, newText);
    const edit: PendingEdit = {
      id,
      uri,
      relPath: rel,
      kind,
      originalText,
      newText,
      added,
      removed,
    };
    this.pending.set(id, edit);
    this.byPath.set(rel, id);
    this.onDidChangeEmitter.fire(this.proposedUri(edit));
    this.logger.debug(
      `editManager: staged ${kind} ${rel} (+${added}/-${removed}), id=${id}`
    );
    return edit;
  }

  // --- diff + apply ------------------------------------------------------

  proposedUri(edit: PendingEdit): vscode.Uri {
    return vscode.Uri.parse(`${PROPOSED_SCHEME}://proposed/${edit.id}`);
  }

  private emptyUri(edit: PendingEdit): vscode.Uri {
    return vscode.Uri.parse(`${PROPOSED_SCHEME}://empty/${edit.id}`);
  }

  async openDiff(id: string): Promise<void> {
    const edit = this.pending.get(id);
    if (!edit) {
      void vscode.window.showWarningMessage(
        'Bosch-CoPilot: that proposed change is no longer available.'
      );
      return;
    }
    const left =
      edit.kind === 'create' ? this.emptyUri(edit) : edit.uri;
    const right = this.proposedUri(edit);
    const title = `${edit.relPath} (proposed ${edit.kind})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, {
      preview: true,
    });
  }

  async applyAll(): Promise<{ applied: number; failed: number }> {
    const edits = this.getStaged();
    if (edits.length === 0) {
      void vscode.window.showInformationMessage(
        'Bosch-CoPilot: no pending changes to apply.'
      );
      return { applied: 0, failed: 0 };
    }

    let applied = 0;
    let failed = 0;
    for (const e of edits) {
      try {
        const wsEdit = new vscode.WorkspaceEdit();
        if (e.kind === 'create') {
          wsEdit.createFile(e.uri, {
            overwrite: false,
            ignoreIfExists: false,
          });
          wsEdit.insert(e.uri, new vscode.Position(0, 0), e.newText);
        } else {
          const doc = await vscode.workspace.openTextDocument(e.uri);
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          wsEdit.replace(e.uri, fullRange, e.newText);
        }
        const ok = await vscode.workspace.applyEdit(wsEdit);
        if (!ok) {
          throw new Error('applyEdit returned false');
        }
        const doc = await vscode.workspace.openTextDocument(e.uri);
        await doc.save();
        applied++;
        this.logger.info(`editManager: applied ${e.kind} ${e.relPath}`);
      } catch (err) {
        failed++;
        this.logger.error(`editManager: failed to apply ${e.relPath}`, err);
      }
    }

    this.pending.clear();
    this.byPath.clear();
    return { applied, failed };
  }

  discardAll(): number {
    const n = this.pending.size;
    this.pending.clear();
    this.byPath.clear();
    this.logger.info(`editManager: discarded ${n} pending edit(s)`);
    return n;
  }
}

// ---------------------------------------------------------------------------
// Module singleton so the (long-lived) edit tools can reach the manager.
// ---------------------------------------------------------------------------

let _editManager: EditManager | undefined;

export function setEditManager(m: EditManager): void {
  _editManager = m;
}

export function getEditManager(): EditManager | undefined {
  return _editManager;
}

// ---------------------------------------------------------------------------

/**
 * Cheap line-level diff stat (added / removed line counts) via an LCS DP.
 * Guarded for very large files — falls back to a coarse estimate.
 */
export function diffStat(
  oldText: string,
  newText: string
): { added: number; removed: number } {
  const a = oldText.length ? oldText.split('\n') : [];
  const b = newText.length ? newText.split('\n') : [];
  if (a.length === 0) {
    return { added: b.length, removed: 0 };
  }
  if (b.length === 0) {
    return { added: 0, removed: a.length };
  }
  // Guard: LCS DP is O(n*m); cap to keep it snappy.
  if (a.length * b.length > 4_000_000) {
    return {
      added: Math.max(0, b.length - a.length),
      removed: Math.max(0, a.length - b.length),
    };
  }
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array((n + 1) * 2).fill(0);
  let prev = 0;
  let cur = n + 1;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[cur + j] = dp[prev + (j - 1)] + 1;
      } else {
        dp[cur + j] = Math.max(dp[prev + j], dp[cur + (j - 1)]);
      }
    }
    const t = prev;
    prev = cur;
    cur = t;
    for (let k = 0; k <= n; k++) {
      dp[cur + k] = 0;
    }
  }
  const lcs = dp[prev + n];
  return { added: n - lcs, removed: m - lcs };
}
