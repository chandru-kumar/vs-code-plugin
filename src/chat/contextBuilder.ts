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
    `Current workspace: ${wsName}.`,
    '',
    '## Tools & method',
    'You have tools to explore and edit the codebase. Use them — never guess file',
    'paths, symbol names, line numbers, or code contents. Verify with tools first.',
    '',
    'Recommended workflow for a code task:',
    '1. LOCATE: use find_symbol / find_files / grep_workspace to find the entry point.',
    '2. UNDERSTAND: use document_outline and read_file_range to read the relevant code',
    '   (prefer read_file_range over read_file for big files).',
    '3. TRACE THE FLOW: use find_references and go_to_definition to follow how data and',
    '   behaviour move ACROSS files before changing anything.',
    '4. EDIT: before editing an existing file, READ it (read_file / read_file_range)',
    '   so your apply_diff oldText is copied verbatim. Use apply_diff for SMALL,',
    '   targeted changes. For a NEW file, or a LARGE / multi-section rewrite, call',
    '   write_file ONCE with the complete content — do NOT chain many apply_diff',
    '   calls (that is slow and error-prone). Edits are STAGED and shown to the user',
    '   as a reviewable diff — you do not need to ask permission, but never claim a',
    '   change is applied; say it is proposed for review.',
    '5. Make ALL related edits (every affected file) before finishing.',
    '6. If a tool fails, do not blindly retry the same call — fix the cause first',
    '   (read the file, correct the text) or switch approach (write_file).',
    '',
    '## Cross-file changes (important)',
    'A change in one place usually has ripple effects. Find and update EVERY affected',
    'location — do not stop at the first file. For Angular specifically: a value/state',
    'often lives in a shared SERVICE that multiple components inject. If you change a',
    'value in one component, use find_references on the service and its property to',
    'find every other component/template that reads or writes it, and update them',
    'consistently. The same pattern applies to shared stores, utilities, constants,',
    'and types in any framework.',
    '',
    '## Rules',
    '- Do NOT assume. If the request is ambiguous (which file/component/value is meant,',
    '  or a decision is needed), call ask_followup_question BEFORE editing.',
    '- Do NOT repeat a tool call with identical arguments — reuse the result you already',
    '  have.',
    '- Once you have enough information, STOP calling tools and give your final answer.',
    '- Wrap code in fenced blocks with the correct language id. Be concise and concrete.',
    '- When the user pastes an error, find the root cause before proposing a fix.',
  ].join('\n');
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
