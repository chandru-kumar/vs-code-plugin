import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { readSettings } from '../config/settings';

export const PARTICIPANT_ID = 'pilotcode.chat';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  logger: Logger
): vscode.Disposable {
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    stream,
    token
  ) => {
    logger.debug('chat.request', {
      prompt: request.prompt,
      command: request.command,
    });

    if (token.isCancellationRequested) {
      return;
    }

    const settings = readSettings();

    // Phase 1: stub responder. We greet the user, surface configuration,
    // and confirm the wiring is alive. Real model calls land in Phase 3.
    stream.markdown(
      `### PilotCode (Phase 1 scaffold)\n\n` +
        `Hi — I'm **@pilotcode**, your local-first AI coding assistant.\n\n` +
        `You asked: \`${escapeBackticks(request.prompt || '(empty prompt)')}\`\n\n`
    );

    stream.markdown(
      `**Current configuration**\n\n` +
        `- Endpoint: \`${settings.endpoint}\`\n` +
        `- Chat model: \`${settings.chatModel}\`\n` +
        `- Completion model: \`${settings.completionModel}\`\n` +
        `- Telemetry: \`${settings.enableTelemetry ? 'on' : 'off (default)'}\`\n\n`
    );

    stream.markdown(
      `> Streaming, tool-calling, MCP, and agentic features will be wired in ` +
        `Phases 2–7. This phase verifies the chat participant + settings ` +
        `pipeline is working end-to-end.\n\n`
    );

    stream.button({
      command: 'pilotcode.diagnose',
      title: 'Run Diagnose',
    });

    stream.button({
      command: 'pilotcode.openSettings',
      title: 'Open PilotCode Settings',
    });

    stream.button({
      command: 'pilotcode.testConnection',
      title: 'Test Endpoint Connection',
    });

    return {
      metadata: { phase: 1 },
    } satisfies vscode.ChatResult;
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('rocket');

  context.subscriptions.push(participant);
  logger.info(`Registered chat participant @pilotcode (id=${PARTICIPANT_ID})`);
  return participant;
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, '\\`');
}
