import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { readSettings } from '../config/settings';
import { ChatClient } from '../model/chatClient';
import { ModelNotFoundError } from '../model/completionClient';
import { buildChatMessages } from './contextBuilder';
import { applySlashCommand, SLASH_COMMANDS } from './slashCommands';
import { PARTICIPANT_ID } from './participantId';
import { AgentLoop } from '../agent/loop';
import type { ToolDescriptor } from '../agent/types';
import { getEditManager, type PendingEdit } from '../agent/editManager';

export { PARTICIPANT_ID };

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  logger: Logger,
  tools: ToolDescriptor[]
): vscode.Disposable {
  const client = new ChatClient(readSettings, logger);
  const agent = new AgentLoop(client, tools, logger);

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

    logger.info(
      `chat: starting request (model=${settings.chatModel}, agent=${settings.agentEnabled}, ` +
        `msgs=${messages.length}, endpoint=${settings.endpoint})`
    );

    try {
      // --- Agent mode (Phase 4) -----------------------------------------
      if (settings.agentEnabled && tools.length > 0) {
        // Start a fresh edit-staging session for this turn.
        const editManager = getEditManager();
        editManager?.beginTurn();

        const agentResult = await agent.run(
          messages,
          {
            stream,
            toolInvocationToken: request.toolInvocationToken,
            maxIterations: settings.agentMaxIterations,
          },
          token
        );

        // If the agent staged file edits, render the review UI.
        const staged = editManager?.getStaged() ?? [];
        if (staged.length > 0) {
          renderEditReview(stream, staged);
          logger.info(
            `chat (agent): staged ${staged.length} edit(s) for review: ` +
              staged.map((e) => e.relPath).join(', ')
          );
        }

        logger.info(
          `chat (agent): ${agentResult.iterations} iter, ` +
            `${agentResult.toolCalls} tool call(s), ${agentResult.totalChars} chars in ` +
            `${agentResult.elapsedMs}ms (first activity ${agentResult.firstActivityMs}ms, ` +
            `staged=${staged.length}, ` +
            `model=${settings.chatModel}${request.command ? `, /${request.command}` : ''})`
        );
        stream.button({
          command: 'bosch-copilot.diagnose',
          title: 'Run Diagnose',
        });
        return {
          metadata: {
            mode: 'agent',
            iterations: agentResult.iterations,
            toolCalls: agentResult.toolCalls,
            stagedEdits: staged.length,
            elapsedMs: agentResult.elapsedMs,
            firstActivityMs: agentResult.firstActivityMs,
            chars: agentResult.totalChars,
            command: request.command ?? null,
          },
        } satisfies vscode.ChatResult;
      }

      // --- Streaming mode (agent disabled) ------------------------------
      logger.debug('chat: using streaming mode (agent disabled)');
      let totalChars = 0;
      let firstTokenMs = -1;
      for await (const chunk of client.stream(messages, token)) {
        if (token.isCancellationRequested) {
          logger.info('chat: cancelled by user');
          break;
        }
        if (chunk.delta) {
          if (firstTokenMs < 0) {
            firstTokenMs = Date.now() - started;
            logger.info(`chat: first token received in ${firstTokenMs}ms`);
          }
          stream.markdown(chunk.delta);
          totalChars += chunk.delta.length;
        }
        if (chunk.done) {
          break;
        }
      }
      if (totalChars === 0 && !token.isCancellationRequested) {
        logger.warn('chat: model returned an empty response (0 chars)');
        stream.markdown(
          '⚠️ The model returned an empty response. This may indicate the model is overloaded ' +
            'or not fully loaded into memory. Try again, or run **Bosch-CoPilot: Diagnose**.\n'
        );
      }
      const elapsed = Date.now() - started;
      logger.info(
        `chat: streamed ${totalChars} chars in ${elapsed}ms ` +
          `(first token ${firstTokenMs}ms, model=${settings.chatModel}` +
          `${request.command ? `, /${request.command}` : ''})`
      );
      stream.button({
        command: 'bosch-copilot.diagnose',
        title: 'Run Diagnose',
      });
      return {
        metadata: {
          mode: 'stream',
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
  logger.info(
    `Registered chat participant @bosch-copilot (id=${PARTICIPANT_ID})`
  );
  return participant;
}

// ---------------------------------------------------------------------------

/**
 * Render the staged-edits review block: a summary list of every file the
 * agent proposes to change, each with an "Open Diff" button, plus global
 * Apply All / Discard buttons. Nothing is written until the user applies.
 */
function renderEditReview(
  stream: vscode.ChatResponseStream,
  staged: PendingEdit[]
): void {
  const totalAdded = staged.reduce((n, e) => n + e.added, 0);
  const totalRemoved = staged.reduce((n, e) => n + e.removed, 0);

  stream.markdown(
    `\n\n---\n\n### 📝 Proposed changes — ${staged.length} file${staged.length === 1 ? '' : 's'} ` +
      `(+${totalAdded} / −${totalRemoved})\n\n` +
      `Review each diff, then **Apply All** or **Discard**. Nothing is written ` +
      `to disk until you apply.\n\n`
  );

  let anyRisky = false;
  for (const e of staged) {
    const kind = e.kind === 'create' ? '🆕 new' : '✏️ edit';
    // Flag edits that remove a lot more than they add — a classic sign of a
    // model passing partial content (which would delete the rest of a file).
    const risky =
      e.kind === 'modify' && e.removed >= 40 && e.removed > e.added * 2;
    anyRisky = anyRisky || risky;
    const warn = risky
      ? ' — ⚠️ **large deletion, review carefully before applying**'
      : '';
    stream.markdown(
      `- ${kind} \`${e.relPath}\` — +${e.added} / −${e.removed}${warn}\n`
    );
    stream.button({
      command: 'bosch-copilot.openProposedDiff',
      title: `Open Diff: ${shortName(e.relPath)}`,
      arguments: [e.id],
    });
  }

  if (anyRisky) {
    stream.markdown(
      `\n> ⚠️ One or more edits **remove many more lines than they add**. ` +
        `This can happen if the assistant accidentally produced partial ` +
        `content. **Open the diff and verify** nothing important is deleted ` +
        `before clicking Apply.\n`
    );
  }

  stream.button({
    command: 'bosch-copilot.applyPendingEdits',
    title: `✅ Apply All (${staged.length})`,
  });
  stream.button({
    command: 'bosch-copilot.discardPendingEdits',
    title: '🗑️ Discard',
  });
}

function shortName(rel: string): string {
  const parts = rel.split('/');
  return parts[parts.length - 1] || rel;
}

function renderHelp(stream: vscode.ChatResponseStream): void {
  const s = readSettings();
  stream.markdown(
    `### Welcome to **@bosch-copilot** 👋\n\n` +
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
    command: 'bosch-copilot.diagnose',
    title: 'Run Diagnose',
  });
  stream.button({
    command: 'bosch-copilot.openSettings',
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
        `Run **Bosch-CoPilot: Diagnose** to see which models are available, ` +
        `or fix \`bosch-copilot.chatModel\` in settings.\n`
    );
    stream.button({ command: 'bosch-copilot.diagnose', title: 'Run Diagnose' });
    stream.button({
      command: 'bosch-copilot.openSettings',
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
  stream.button({ command: 'bosch-copilot.diagnose', title: 'Run Diagnose' });
  stream.button({
    command: 'bosch-copilot.showOutput',
    title: 'Show Output Channel',
  });
  return { metadata: { error: 'request_failed', message: msg } };
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, '\\`');
}
