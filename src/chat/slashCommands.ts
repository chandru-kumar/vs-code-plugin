import type * as vscode from 'vscode';
import type { ChatMessage } from '../model/types';

export interface SlashCommandDef {
  name: string;
  description: string;
  /** Extra instructions appended to the system prompt for this command. */
  systemAddendum: string;
  /** Builds the user-message body from the raw prompt text. */
  userTemplate: (rawPrompt: string) => string;
}

/**
 * Registered slash commands. The `name` here must match the entries in
 * `package.json` → `contributes.chatParticipants[0].commands`.
 */
export const SLASH_COMMANDS: Record<string, SlashCommandDef> = {
  explain: {
    name: 'explain',
    description: 'Explain the selected / active code',
    systemAddendum:
      ' For /explain: produce a concise, clear walkthrough of what the code does. ' +
      'Identify the inputs, outputs, control flow, and any non-obvious behaviour. ' +
      'Call out edge cases and pitfalls. Do not rewrite the code.',
    userTemplate: (p) =>
      p ? `Please explain this code. Focus: ${p}` : 'Please explain this code.',
  },
  fix: {
    name: 'fix',
    description: 'Find and fix bugs in the selected / active code',
    systemAddendum:
      ' For /fix: first identify the bug or issue in 1-2 sentences. ' +
      'Then provide the corrected code in a fenced block. ' +
      'End with a 2-3 sentence explanation of the fix. ' +
      'If multiple issues exist, fix the most impactful one and list the rest.',
    userTemplate: (p) =>
      p
        ? `Please find and fix the bug in this code. Additional context: ${p}`
        : 'Please find and fix the bug in this code.',
  },
  test: {
    name: 'test',
    description: 'Generate unit tests for the selected / active code',
    systemAddendum:
      ' For /test: generate idiomatic unit tests using the most appropriate framework ' +
      'for the detected language (e.g. pytest for Python, jest/vitest for JS/TS, ' +
      'go test for Go, JUnit for Java). Cover the happy path, edge cases, and ' +
      'error conditions. Return only the test file content in a single fenced block.',
    userTemplate: (p) =>
      p
        ? `Please generate unit tests for this code. ${p}`
        : 'Please generate comprehensive unit tests for this code.',
  },
  refactor: {
    name: 'refactor',
    description: 'Refactor the selected / active code for clarity',
    systemAddendum:
      ' For /refactor: improve readability, extract helpers where they aid clarity, ' +
      'and reduce duplication. PRESERVE behaviour exactly — do not change the API or ' +
      'semantics. Show the full refactored code in a fenced block, then summarise ' +
      'the changes in 2-3 bullet points.',
    userTemplate: (p) =>
      p
        ? `Please refactor this code for clarity. Focus: ${p}`
        : 'Please refactor this code for clarity.',
  },
};

/**
 * If a slash command was used, rewrite the messages array in-place to
 * include the command-specific system addendum and user template.
 * Returns the same messages reference for convenience.
 */
export function applySlashCommand(
  command: string,
  messages: ChatMessage[],
  request: vscode.ChatRequest
): ChatMessage[] {
  const def = SLASH_COMMANDS[command];
  if (!def) {
    return messages;
  }

  // 1. Append addendum to the system prompt.
  if (messages.length > 0 && messages[0].role === 'system') {
    messages[0] = {
      role: 'system',
      content: messages[0].content + def.systemAddendum,
    };
  }

  // 2. Rewrite the last (current) user message: keep any context the
  //    contextBuilder prepended, but replace the raw prompt with the
  //    command-templated version.
  if (messages.length > 0) {
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last.role === 'user') {
      const raw = request.prompt;
      const templated = def.userTemplate(raw);
      // Replace the trailing raw prompt with the templated one. If the
      // raw prompt is empty or missing, just append the template.
      const newContent =
        raw && last.content.endsWith(raw)
          ? last.content.slice(0, last.content.length - raw.length) + templated
          : `${last.content}\n${templated}`.trim();
      messages[lastIdx] = { role: 'user', content: newContent };
    }
  }

  return messages;
}
