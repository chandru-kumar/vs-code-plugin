import * as vscode from 'vscode';
import type { ChatMessage } from '../model/types';
import { PARTICIPANT_ID } from './participantId';

const MAX_HISTORY_TURNS = 10;
const MAX_FILE_CONTEXT_CHARS = 4000;
const MAX_REFERENCED_FILES = 5;

/**
 * Builds the OpenAI-style messages array for a chat request:
 *   - system prompt with workspace context
 *   - prior turns (capped, our-participant-only)
 *   - any explicit `#file:` / `#selection` references the user added
 *   - the current user turn, prefixed with active-editor context if any
 */
export async function buildChatMessages(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

  messages.push({
    role: 'system',
    content: buildSystemPrompt(),
  });

  // Prior turns — only our participant's, capped.
  const ours = chatContext.history.filter(isOurTurn);
  const recent = ours.slice(-MAX_HISTORY_TURNS);
  for (const turn of recent) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push({
        role: 'user',
        content: turn.prompt,
      });
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = serializeResponseTurn(turn);
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
    }
  }

  // Current user turn — context + references + prompt
  const contextParts: string[] = [];

  const editorCtx = buildActiveEditorBlock();
  if (editorCtx) {
    contextParts.push(editorCtx);
  }

  const refsCtx = await buildReferencesBlock(request.references);
  if (refsCtx) {
    contextParts.push(refsCtx);
  }

  const userContent =
    contextParts.length > 0
      ? `${contextParts.join('\n\n')}\n\n${request.prompt}`
      : request.prompt;

  messages.push({ role: 'user', content: userContent });

  return messages;
}

// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const ws = vscode.workspace.workspaceFolders;
  const wsName = ws?.[0]?.name ?? '(no workspace)';
  return [
    'You are Bosch-CoPilot, a local-first AI coding assistant integrated into VS Code.',
    'You help the user write, understand, refactor, and test code in their workspace.',
    'Always wrap code in fenced code blocks with the correct language identifier.',
    'Be concise and precise. Prefer concrete answers over hedging.',
    'When the user pastes errors, identify the root cause before proposing a fix.',
    `Current workspace: ${wsName}.`,
  ].join(' ');
}

function buildActiveEditorBlock(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const doc = editor.document;
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') {
    return undefined;
  }
  const file = vscode.workspace.asRelativePath(doc.uri);

  if (!editor.selection.isEmpty) {
    const text = doc.getText(editor.selection).slice(0, MAX_FILE_CONTEXT_CHARS);
    const start = editor.selection.start.line + 1;
    const end = editor.selection.end.line + 1;
    return [
      `Selected code in \`${file}\` (lines ${start}-${end}, ${doc.languageId}):`,
      '```' + doc.languageId,
      text,
      '```',
    ].join('\n');
  }

  const cursor = editor.selection.active;
  return `Active editor: \`${file}\` (cursor at line ${cursor.line + 1}, ${doc.languageId})`;
}

async function buildReferencesBlock(
  references: readonly vscode.ChatPromptReference[]
): Promise<string | undefined> {
  if (references.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  let included = 0;

  for (const ref of references) {
    if (included >= MAX_REFERENCED_FILES) {
      break;
    }
    const value = ref.value;

    if (value instanceof vscode.Uri) {
      const block = await readFileBlock(value);
      if (block) {
        parts.push(block);
        included++;
      }
    } else if (value instanceof vscode.Location) {
      const block = await readLocationBlock(value);
      if (block) {
        parts.push(block);
        included++;
      }
    }
    // Other reference types (string, etc.) are skipped — VS Code already
    // expands them into the prompt text.
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

async function readFileBlock(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText().slice(0, MAX_FILE_CONTEXT_CHARS);
    const file = vscode.workspace.asRelativePath(uri);
    return [
      `Reference \`${file}\` (${doc.languageId}):`,
      '```' + doc.languageId,
      text,
      '```',
    ].join('\n');
  } catch {
    return undefined;
  }
}

async function readLocationBlock(
  loc: vscode.Location
): Promise<string | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(loc.uri);
    const text = doc.getText(loc.range).slice(0, MAX_FILE_CONTEXT_CHARS);
    const file = vscode.workspace.asRelativePath(loc.uri);
    const start = loc.range.start.line + 1;
    const end = loc.range.end.line + 1;
    return [
      `Reference \`${file}\` (lines ${start}-${end}, ${doc.languageId}):`,
      '```' + doc.languageId,
      text,
      '```',
    ].join('\n');
  } catch {
    return undefined;
  }
}

function isOurTurn(
  turn: vscode.ChatRequestTurn | vscode.ChatResponseTurn
): boolean {
  return turn.participant === PARTICIPANT_ID;
}

function serializeResponseTurn(turn: vscode.ChatResponseTurn): string {
  const parts: string[] = [];
  for (const r of turn.response) {
    if (r instanceof vscode.ChatResponseMarkdownPart) {
      parts.push(r.value.value);
    }
    // Buttons, file refs, etc. are deliberately omitted from history.
  }
  return parts.join('').trim();
}
