import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ToolDefinition } from '../agent/types';
import { textResult } from './util';

interface AskFollowupInput {
  question: string;
  /** Optional suggested answers shown as quick-pick choices. */
  options?: string[];
}

/**
 * Lets the agent ask the user a clarifying question mid-task instead of
 * guessing. Renders a QuickPick (when `options` are given) or an InputBox,
 * and returns the user's answer to the model so it can continue correctly.
 *
 * This is intentionally a no-confirmation, read-only-feeling tool: it does
 * not change anything, it only gathers information.
 */
class AskFollowupTool implements vscode.LanguageModelTool<AskFollowupInput> {
  constructor(private readonly logger: Logger) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AskFollowupInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const question = (options.input.question ?? '').trim();
    if (!question) {
      throw new Error('ask_followup_question: `question` must be non-empty.');
    }
    const choices = (options.input.options ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    this.logger.info(
      `ask_followup_question: "${question}"` +
        (choices.length ? ` [${choices.length} option(s)]` : '')
    );

    let answer: string | undefined;
    if (choices.length > 0) {
      const picked = await vscode.window.showQuickPick(
        [...choices, '✍️ Type a custom answer…'],
        {
          title: 'Bosch-CoPilot needs your input',
          placeHolder: question,
          ignoreFocusOut: true,
        }
      );
      if (picked === '✍️ Type a custom answer…') {
        answer = await vscode.window.showInputBox({
          title: 'Bosch-CoPilot — your answer',
          prompt: question,
          ignoreFocusOut: true,
        });
      } else {
        answer = picked;
      }
    } else {
      answer = await vscode.window.showInputBox({
        title: 'Bosch-CoPilot needs your input',
        prompt: question,
        ignoreFocusOut: true,
      });
    }

    if (token.isCancellationRequested) {
      return textResult('The user cancelled before answering.');
    }
    if (answer === undefined || answer.trim().length === 0) {
      this.logger.info('ask_followup_question: user dismissed without answering');
      return textResult(
        'The user dismissed the question without answering. Proceed with your ' +
          'best reasonable assumption, and state the assumption you made.'
      );
    }

    this.logger.info(`ask_followup_question: answered "${answer}"`);
    return textResult(`The user answered: ${answer}`);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<AskFollowupInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Asking: ${truncate(options.input.question, 60)}`,
    };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export const askFollowupTool: ToolDefinition<AskFollowupInput> = {
  descriptor: {
    llmName: 'ask_followup_question',
    vsCodeName: 'bosch_copilot_ask_followup_question',
    description:
      'Ask the user a clarifying question when the request is ambiguous or you ' +
      'are missing information you cannot obtain with the other tools (e.g. ' +
      'which of several matching files/components is meant, the desired new ' +
      'value, or a yes/no decision). Provide `options` for a multiple-choice ' +
      'prompt, or omit them for free text. PREFER asking over guessing when a ' +
      'wrong assumption would lead to incorrect edits. Returns the user’s answer.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The clarifying question to ask the user.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional suggested answers shown as selectable choices.',
        },
      },
      required: ['question'],
    },
    destructive: false,
  },
  factory: (logger) => new AskFollowupTool(logger),
};
