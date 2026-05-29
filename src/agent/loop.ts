import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ChatClient } from '../model/chatClient';
import { ToolsNotSupportedError } from '../model/completionClient';
import type { ChatMessage, OpenAITool, ToolCall } from '../model/types';
import type { ToolDescriptor } from './types';

export interface AgentLoopOptions {
  /** Used to surface tool calls + the final answer in the chat UI. */
  stream: vscode.ChatResponseStream;
  /**
   * Token from `ChatRequest.toolInvocationToken` — passed to
   * `vscode.lm.invokeTool` so confirmation prompts render *in the chat*.
   */
  toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
  /** Hard cap on iterations to prevent runaway loops. */
  maxIterations: number;
}

export interface AgentLoopResult {
  iterations: number;
  toolCalls: number;
  /** Total chars of *assistant* text rendered into the chat (excluding tool UX). */
  totalChars: number;
  /** ms from `run()` start to the last byte rendered. */
  elapsedMs: number;
  /** ms to first byte of any assistant content (or first tool call). */
  firstActivityMs: number;
}

/**
 * ReAct loop. Runs non-streaming chat completions in a loop, invoking
 * tools when the model requests them via `tool_calls`, until the model
 * returns a final answer without tool calls (or `maxIterations` is hit).
 *
 * Why non-streaming: streaming with tools requires assembling partial
 * `tool_calls` deltas across chunks; the loop UX is already incremental
 * because each tool call renders as soon as it starts. We can layer
 * proper streaming for the final answer in a Phase 4 polish pass.
 */
export class AgentLoop {
  constructor(
    private readonly chatClient: ChatClient,
    private readonly tools: ToolDescriptor[],
    private readonly logger: Logger
  ) {}

  async run(
    messages: ChatMessage[],
    options: AgentLoopOptions,
    token: vscode.CancellationToken
  ): Promise<AgentLoopResult> {
    const started = Date.now();
    let iterations = 0;
    let toolCalls = 0;
    let totalChars = 0;
    let firstActivityMs = -1;

    const openAITools = this.toOpenAITools();
    const byLlmName = new Map<string, ToolDescriptor>(
      this.tools.map((t) => [t.llmName, t])
    );

    options.stream.progress('Thinking…');

    while (iterations < options.maxIterations) {
      iterations++;
      if (token.isCancellationRequested) {
        break;
      }

      this.logger.debug(
        `agent: iteration ${iterations}/${options.maxIterations}`
      );

      let result;
      try {
        result = await this.chatClient.chat(messages, token, {
          tools: openAITools,
          toolChoice: 'auto',
        });
      } catch (err) {
        if (err instanceof ToolsNotSupportedError) {
          // Model doesn't support native tool calling — fall back to
          // streaming without tools so the user sees tokens immediately.
          this.logger.warn(
            `agent: model '${err.modelName}' does not support tools, ` +
              `falling back to streaming chat`
          );
          options.stream.markdown(
            `> ⚠️ Model \`${err.modelName}\` does not support tool calling. ` +
              `Answering without tools — consider switching \`bosch-copilot.chatModel\` ` +
              `to an instruct/chat model (e.g. \`qwen2.5-coder:7b\`).\n\n`
          );
          for await (const chunk of this.chatClient.stream(messages, token)) {
            if (token.isCancellationRequested) {
              break;
            }
            if (chunk.delta) {
              options.stream.markdown(chunk.delta);
              totalChars += chunk.delta.length;
            }
            if (chunk.done) {
              break;
            }
          }
          return {
            iterations,
            toolCalls,
            totalChars,
            elapsedMs: Date.now() - started,
            firstActivityMs: Date.now() - started,
          };
        }
        throw err;
      }

      // Always append the assistant's reply (tool_calls or content) so
      // the next loop iteration has the full conversation.
      messages.push(result.message);

      // Case 1: model produced a final answer (no tool calls).
      if (
        !result.message.tool_calls ||
        result.message.tool_calls.length === 0
      ) {
        const content = result.message.content;
        if (content.length > 0) {
          if (firstActivityMs < 0) {
            firstActivityMs = Date.now() - started;
          }
          options.stream.markdown(content);
          totalChars += content.length;
        } else {
          // Empty response with no tool calls — model returned nothing useful.
          this.logger.warn(
            `agent: model returned empty content with no tool calls ` +
              `(iteration ${iterations}, finish_reason=${result.finishReason})`
          );
          options.stream.markdown(
            '⚠️ The model returned an empty response. This may indicate the model is overloaded, ' +
              'still loading, or does not support tool calling properly. ' +
              'Try again, or switch to a different model.\n'
          );
        }
        this.logger.info(
          `agent: done — ${iterations} iteration(s), ${toolCalls} tool call(s), ` +
            `${totalChars} chars in ${Date.now() - started}ms`
        );
        return {
          iterations,
          toolCalls,
          totalChars,
          elapsedMs: Date.now() - started,
          firstActivityMs: firstActivityMs < 0 ? 0 : firstActivityMs,
        };
      }

      // Case 2: model requested tool calls. Execute them in order.
      for (const tc of result.message.tool_calls) {
        if (token.isCancellationRequested) {
          break;
        }
        toolCalls++;
        if (firstActivityMs < 0) {
          firstActivityMs = Date.now() - started;
        }
        await this.invokeOneToolCall(tc, byLlmName, messages, options, token);
      }
      // Loop continues — next iteration sends the tool results back to the model.
    }

    // Hit the iteration cap.
    options.stream.markdown(
      `\n\n> ⚠️ **Stopped after ${options.maxIterations} agent iteration(s).** ` +
        `Raise \`bosch-copilot.agent.maxIterations\` if you need longer chains, or ` +
        `simplify the request.\n`
    );
    this.logger.warn(
      `agent: stopped at maxIterations=${options.maxIterations} (${toolCalls} tool calls so far)`
    );
    return {
      iterations,
      toolCalls,
      totalChars,
      elapsedMs: Date.now() - started,
      firstActivityMs: firstActivityMs < 0 ? 0 : firstActivityMs,
    };
  }

  // ---------------------------------------------------------------------

  private toOpenAITools(): OpenAITool[] {
    return this.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.llmName,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Look up, invoke, and record the result of a single tool call. Always
   * appends a `role: 'tool'` message — even on failure — so the model can
   * see what went wrong and recover on the next iteration.
   */
  private async invokeOneToolCall(
    tc: ToolCall,
    byLlmName: Map<string, ToolDescriptor>,
    messages: ChatMessage[],
    options: AgentLoopOptions,
    token: vscode.CancellationToken
  ): Promise<void> {
    const name = tc.function.name;
    const desc = byLlmName.get(name);

    options.stream.markdown(
      `\n\n🔧 **\`${name}\`** ${formatArgsPreview(tc.function.arguments)}\n\n`
    );

    if (!desc) {
      const msg = `Unknown tool: '${name}'.`;
      options.stream.markdown(`❌ ${msg}\n`);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name,
        content: msg,
      });
      return;
    }

    let input: object;
    try {
      const parsed = tc.function.arguments
        ? JSON.parse(tc.function.arguments)
        : {};
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          'tool arguments must be a JSON object, not an array or primitive'
        );
      }
      input = parsed as object;
    } catch (e) {
      const msg = `Invalid arguments: ${(e as Error).message}`;
      options.stream.markdown(`❌ ${msg}\n`);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name,
        content: msg,
      });
      return;
    }

    try {
      const result = await vscode.lm.invokeTool(
        desc.vsCodeName,
        {
          input,
          toolInvocationToken: options.toolInvocationToken,
        },
        token
      );
      const content = serializeToolResult(result);
      options.stream.markdown(
        `✅ \`${name}\` → ${content.length} char${content.length === 1 ? '' : 's'}\n`
      );
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name,
        content,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      options.stream.markdown(
        `❌ \`${name}\` failed: ${escapeBackticks(msg)}\n`
      );
      this.logger.warn(`agent: tool '${name}' failed`, err);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name,
        content: `Error: ${msg}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------

function serializeToolResult(result: vscode.LanguageModelToolResult): string {
  const parts: string[] = [];
  for (const c of result.content) {
    if (c instanceof vscode.LanguageModelTextPart) {
      parts.push(c.value);
    } else {
      // PromptTsxPart or future part types — fall back to JSON.
      try {
        parts.push(JSON.stringify(c));
      } catch {
        parts.push('[unrenderable tool result part]');
      }
    }
  }
  return parts.join('\n');
}

function formatArgsPreview(jsonArgs: string): string {
  if (!jsonArgs) {
    return '`()`';
  }
  // Try to render a short, single-line inline preview.
  try {
    const parsed = JSON.parse(jsonArgs);
    const compact = JSON.stringify(parsed);
    if (compact.length <= 120) {
      return `\`${escapeBackticks(compact)}\``;
    }
    return `\`${escapeBackticks(compact.slice(0, 117) + '…')}\``;
  } catch {
    return `\`${escapeBackticks(jsonArgs.slice(0, 120))}\``;
  }
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, '\\`');
}
