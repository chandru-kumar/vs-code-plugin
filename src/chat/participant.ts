import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { readSettings } from '../config/settings';
import { ChatClient } from '../model/chatClient';
import { ModelNotFoundError } from '../model/completionClient';
import { buildChatMessages } from './contextBuilder';
import { applySlashCommand, SLASH_COMMANDS } from './slashCommands';
import { PARTICIPANT_ID } from './participantId';

export { PARTICIPANT_ID };

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  logger: Logger
): vscode.Disposable {
  const client = new ChatClient(readSettings, logger);

  const handler: vscode.ChatRequestHandler = async (
    request,
    chatContext,
    stream,
    token
  ) => {
    logger.debug('chat.request', {
      prompt: request.prompt,
      command: request.command,
      references: request.references.length,
    });

    if (token.isCancellationRequested) {
      return;
    }

    // No prompt + no slash command → show a quick help card instead of
    // wasting a model call.
    if (!request.prompt.trim() && !request.command) {
      renderHelp(stream);
      return { metadata: { kind: 'help' } } satisfies vscode.ChatResult;
    }

    const settings = readSettings();
    let messages = await buildChatMessages(request, chatContext);
    if (request.command) {
      messages = applySlashCommand(request.command, messages, request);
    }

    const started = Date.now();
    let totalChars = 0;
    let firstTokenMs = -1;

    try {
      for await (const chunk of client.stream(messages, token)) {
        if (token.isCancellationRequested) {
          break;
        }
        if (chunk.delta) {
          if (firstTokenMs < 0) {
            firstTokenMs = Date.now() - started;
          }
          stream.markdown(chunk.delta);
          totalChars += chunk.delta.length;
        }
        if (chunk.done) {
          break;
        }
      }

      const elapsed = Date.now() - started;
      logger.info(
        `chat: streamed ${totalChars} chars in ${elapsed}ms ` +
          `(first token ${firstTokenMs}ms, model=${settings.chatModel}` +
          `${request.command ? `, /${request.command}` : ''})`
      );

      // Always offer the diagnose button — easy escape hatch.
      stream.button({
        command: 'pilotcode.diagnose',
        title: 'Run Diagnose',
      });

      return {
        metadata: {
          elapsedMs: elapsed,
          firstTokenMs,
          chars: totalChars,
          command: request.command ?? null,
        },
      } satisfies vscode.ChatResult;
    } catch (err) {
      return handleChatError(err, stream, logger, settings.endpoint);
    }
  };

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    handler
  );
  participant.iconPath = new vscode.ThemeIcon('rocket');

  // Generic follow-up suggestions shown under any reply.
  participant.followupProvider = {
    provideFollowups(result) {
      if (!result || (result.metadata as { error?: string })?.error) {
        return [];
      }
      return [
        {
          prompt: 'Explain this in more detail',
          label: '💡 Explain further',
        },
        {
          prompt: 'Write unit tests for this',
          label: '🧪 Write tests',
          command: 'test',
        },
        {
          prompt: 'Refactor for clarity',
          label: '🧹 Refactor',
          command: 'refactor',
        },
      ];
    },
  };

  context.subscriptions.push(participant);
  logger.info(`Registered chat participant @pilotcode (id=${PARTICIPANT_ID})`);
  return participant;
}

// ---------------------------------------------------------------------------

function renderHelp(stream: vscode.ChatResponseStream): void {
  const s = readSettings();
  stream.markdown(
    `### Welcome to **@pilotcode** 👋\n\n` +
      `I'm a local-first AI coding assistant powered by your own model ` +
      `(currently \`${s.chatModel}\` at \`${s.endpoint}\`). ` +
      `Ask me anything about your code.\n\n` +
      `**Slash commands:**\n\n` +
      Object.values(SLASH_COMMANDS)
        .map((c) => `- \`/${c.name}\` — ${c.description}`)
        .join('\n') +
      `\n\n**Tips:**\n` +
      `- Select code in the editor, then ask me about it.\n` +
      `- Use \`#file:path/to/foo.ts\` to attach a file.\n` +
      `- Inline ghost-text completions are live as you type.\n`
  );
  stream.button({
    command: 'pilotcode.diagnose',
    title: 'Run Diagnose',
  });
  stream.button({
    command: 'pilotcode.openSettings',
    title: 'Open Settings',
  });
}

function handleChatError(
  err: unknown,
  stream: vscode.ChatResponseStream,
  logger: Logger,
  endpoint: string
): vscode.ChatResult {
  if (err instanceof ModelNotFoundError) {
    logger.error(`chat: model not found: ${err.modelName}`);
    stream.markdown(
      `\n\n❌ **Model \`${err.modelName}\` not found** on \`${endpoint}\`.\n\n` +
        `Run **PilotCode: Diagnose** to see which models are available, ` +
        `or fix \`pilotcode.chatModel\` in settings.\n`
    );
    stream.button({ command: 'pilotcode.diagnose', title: 'Run Diagnose' });
    stream.button({
      command: 'pilotcode.openSettings',
      title: 'Open Settings',
    });
    return { metadata: { error: 'model_not_found' } };
  }

  const msg = err instanceof Error ? err.message : String(err);
  logger.error('chat request failed', err);
  stream.markdown(
    `\n\n❌ **Chat request failed:** \`${escapeBackticks(msg)}\`\n\n` +
      `Check that your endpoint (\`${endpoint}\`) is reachable and that the ` +
      `configured chat model exists.\n`
  );
  stream.button({ command: 'pilotcode.diagnose', title: 'Run Diagnose' });
  stream.button({
    command: 'pilotcode.showOutput',
    title: 'Show Output Channel',
  });
  return { metadata: { error: 'request_failed', message: msg } };
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, '\\`');
}
