import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { ChatClient } from '../model/chatClient';
import { ToolsNotSupportedError } from '../model/completionClient';
import type { ChatMessage, OpenAITool, ToolCall } from '../model/types';
import type { ToolDescriptor } from './types';
import {
  reasoningMessage,
  reviewingMessage,
  toolMessage,
  FINALISING,
} from './progressMessages';

/** Abort tool use after this many tool failures in a row. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Hard ceiling on total tool calls in a single turn (runaway backstop). */
const MAX_TOTAL_TOOL_CALLS = 40;

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
 * ReAct loop. Runs non-streaming chat completions in a loop, invoking tools
 * when the model requests them, until the model produces a final answer
 * without tool calls (or `maxIterations` is hit).
 *
 * Hardening:
 *  - **Duplicate-call guard:** an identical (name + args) tool call is not
 *    re-executed; the prior result is returned with a nudge to use it.
 *  - **Forced final answer:** when the loop ends without a textual answer
 *    (cap hit, or an empty assistant turn) it makes one final no-tools call
 *    so the user always gets a response — never silence.
 *  - **Live progress:** the status line shows phase/tool-specific messages.
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
    let reviewCounter = 0;

    const markActivity = (): void => {
      if (firstActivityMs < 0) {
        firstActivityMs = Date.now() - started;
      }
    };

    const openAITools = this.toOpenAITools();
    const byLlmName = new Map<string, ToolDescriptor>(
      this.tools.map((t) => [t.llmName, t])
    );
    // Caches keyed by tool-call signature: successful results (for reuse)
    // and failures (to stop the model repeating an identical failing call).
    const resultCache = new Map<string, string>();
    const failedCache = new Map<string, string>();
    let consecutiveFailures = 0;

    const finish = (): AgentLoopResult => ({
      iterations,
      toolCalls,
      totalChars,
      elapsedMs: Date.now() - started,
      firstActivityMs: firstActivityMs < 0 ? 0 : firstActivityMs,
    });

    while (iterations < options.maxIterations) {
      iterations++;
      if (token.isCancellationRequested) {
        return finish();
      }

      options.stream.progress(reasoningMessage(iterations));
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
          this.logger.warn(
            `agent: model '${err.modelName}' does not support tools, ` +
              `falling back to streaming chat`
          );
          options.stream.markdown(
            `> ⚠️ Model \`${err.modelName}\` does not support tool calling. ` +
              `Answering without tools.\n\n`
          );
          totalChars += await this.streamPlain(messages, options, token, markActivity);
          return finish();
        }
        throw err;
      }

      messages.push(result.message);

      const calls = result.message.tool_calls ?? [];

      // Case 1: final answer (no tool calls).
      if (calls.length === 0) {
        const content = result.message.content;
        if (content.length > 0) {
          markActivity();
          options.stream.markdown(content);
          totalChars += content.length;
          this.logger.info(
            `agent: done — ${iterations} iteration(s), ${toolCalls} tool call(s), ` +
              `${totalChars} chars in ${Date.now() - started}ms`
          );
          return finish();
        }
        // Empty answer with no tools — force a proper final answer.
        this.logger.warn(
          `agent: empty assistant turn (iter ${iterations}, ` +
            `finish_reason=${result.finishReason}) — forcing final answer`
        );
        totalChars += await this.forceFinalAnswer(messages, options, token, markActivity);
        return finish();
      }

      // Case 2: execute the requested tool calls (with dedup + failure guard).
      for (const tc of calls) {
        if (token.isCancellationRequested) {
          return finish();
        }
        toolCalls++;
        markActivity();
        const ok = await this.invokeOneToolCall(
          tc,
          byLlmName,
          messages,
          options,
          token,
          resultCache,
          failedCache
        );
        consecutiveFailures = ok ? 0 : consecutiveFailures + 1;

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.logger.warn(
            `agent: ${consecutiveFailures} consecutive tool failures — ` +
              `aborting tool use and forcing a final answer`
          );
          options.stream.markdown(
            `\n\n> ⚠️ Several tool calls failed in a row. Stopping tool use ` +
              `and answering with what I have.\n\n`
          );
          totalChars += await this.forceFinalAnswer(messages, options, token, markActivity);
          return finish();
        }
        if (toolCalls >= MAX_TOTAL_TOOL_CALLS) {
          this.logger.warn(
            `agent: hit MAX_TOTAL_TOOL_CALLS=${MAX_TOTAL_TOOL_CALLS} — forcing final answer`
          );
          options.stream.markdown(
            `\n\n> ℹ️ Reached the tool-call budget for this turn; summarising.\n\n`
          );
          totalChars += await this.forceFinalAnswer(messages, options, token, markActivity);
          return finish();
        }
      }

      // If the model's response was truncated by the token limit, its tool
      // args are often malformed — nudge it to be concise next iteration.
      if (result.finishReason === 'length') {
        this.logger.warn(
          `agent: response truncated (finish_reason=length) at iter ${iterations}`
        );
        messages.push({
          role: 'user',
          content:
            '(Your previous response was cut off at the token limit. Do NOT ' +
            'paste large file contents inside tool arguments. For a big ' +
            'rewrite, call write_file ONCE with the complete file; for small ' +
            'changes use a single focused apply_diff. Keep going.)',
        });
      }

      reviewCounter++;
      options.stream.progress(reviewingMessage(reviewCounter));
    }

    // Hit the iteration cap — force a final answer instead of going silent.
    this.logger.warn(
      `agent: reached maxIterations=${options.maxIterations} ` +
        `(${toolCalls} tool calls) — forcing final answer`
    );
    options.stream.markdown(
      `\n\n> ℹ️ Reached the ${options.maxIterations}-step limit; ` +
        `summarising with what I have so far.\n\n`
    );
    totalChars += await this.forceFinalAnswer(messages, options, token, markActivity);
    return finish();
  }

  // ---------------------------------------------------------------------

  /**
   * Make one final model call with **no tools** and stream the answer, so
   * the user always gets a textual response. Used at the iteration cap and
   * when the model returns an empty turn.
   */
  private async forceFinalAnswer(
    messages: ChatMessage[],
    options: AgentLoopOptions,
    token: vscode.CancellationToken,
    markActivity: () => void
  ): Promise<number> {
    if (token.isCancellationRequested) {
      return 0;
    }
    options.stream.progress(FINALISING);
    messages.push({
      role: 'user',
      content:
        'Stop using tools now. Using everything you have gathered so far, ' +
        'give your best, concrete final answer to my original request. If you ' +
        'proposed file edits, summarise them and remind me to review the diff.',
    });
    return this.streamPlain(messages, options, token, markActivity);
  }

  /** Stream a plain (no-tools) completion into the chat. Returns char count. */
  private async streamPlain(
    messages: ChatMessage[],
    options: AgentLoopOptions,
    token: vscode.CancellationToken,
    markActivity: () => void
  ): Promise<number> {
    let chars = 0;
    try {
      for await (const chunk of this.chatClient.stream(messages, token)) {
        if (token.isCancellationRequested) {
          break;
        }
        if (chunk.delta) {
          markActivity();
          options.stream.markdown(chunk.delta);
          chars += chunk.delta.length;
        }
        if (chunk.done) {
          break;
        }
      }
    } catch (err) {
      this.logger.error('agent: forced final answer failed', err);
      options.stream.markdown(
        '\n\n⚠️ I gathered the information but failed to compose a final ' +
          'answer. Please try again.\n'
      );
    }
    if (chars === 0 && !token.isCancellationRequested) {
      options.stream.markdown(
        '\n\n⚠️ The model returned an empty final answer. Try rephrasing, or ' +
          'run **Bosch-CoPilot: Diagnose**.\n'
      );
    }
    return chars;
  }

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
   * appends a `role: 'tool'` message — even on failure / dedup — so the
   * conversation stays valid (every tool_call needs a matching result).
   *
   * Returns `true` if the call succeeded, `false` on any failure (used by
   * the caller to track consecutive failures).
   */
  private async invokeOneToolCall(
    tc: ToolCall,
    byLlmName: Map<string, ToolDescriptor>,
    messages: ChatMessage[],
    options: AgentLoopOptions,
    token: vscode.CancellationToken,
    resultCache: Map<string, string>,
    failedCache: Map<string, string>
  ): Promise<boolean> {
    const name = tc.function.name;
    const desc = byLlmName.get(name);
    const signature = signatureOf(tc);
    const pushTool = (content: string): void => {
      messages.push({ role: 'tool', tool_call_id: tc.id, name, content });
    };

    // Duplicate-success guard: same tool + args as a prior successful call.
    const cached = resultCache.get(signature);
    if (cached !== undefined) {
      options.stream.markdown(
        `\n\n↩️ **\`${name}\`** (skipped — already ran with the same arguments)\n`
      );
      this.logger.debug(`agent: dedup '${name}' (${signature.slice(0, 80)})`);
      pushTool(
        `(You already called ${name} with these exact arguments earlier. ` +
          `Re-using that result — do not call it again. If you have enough ` +
          `information now, give your final answer.)\n\n` +
          cached
      );
      return true;
    }

    // Repeated-failure guard: identical call already failed this turn.
    const priorFail = failedCache.get(signature);
    if (priorFail !== undefined) {
      options.stream.markdown(
        `\n\n↩️ **\`${name}\`** (skipped — this exact call already failed)\n`
      );
      this.logger.debug(`agent: skip repeat-failed '${name}'`);
      pushTool(
        `(You already tried this EXACT ${name} call and it failed with: ` +
          `${priorFail}\nDo NOT repeat it. Instead: call read_file to get the ` +
          `current exact text, OR use write_file with the full corrected file.)`
      );
      return false;
    }

    options.stream.progress(toolMessage(name));
    options.stream.markdown(
      `\n\n🔧 **\`${name}\`** ${formatArgsPreview(tc.function.arguments)}\n\n`
    );

    if (!desc) {
      const msg = `Unknown tool: '${name}'.`;
      options.stream.markdown(`❌ ${msg}\n`);
      pushTool(msg);
      return false;
    }

    let input: object;
    try {
      const parsed = tc.function.arguments
        ? JSON.parse(tc.function.arguments)
        : {};
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(
          'tool arguments must be a JSON object, not an array or primitive'
        );
      }
      input = parsed as object;
    } catch (e) {
      const msg = `Invalid arguments: ${(e as Error).message}`;
      options.stream.markdown(`❌ ${msg}\n`);
      failedCache.set(signature, msg);
      pushTool(msg);
      return false;
    }

    try {
      const result = await vscode.lm.invokeTool(
        desc.vsCodeName,
        { input, toolInvocationToken: options.toolInvocationToken },
        token
      );
      const content = serializeToolResult(result);
      options.stream.markdown(
        `✅ \`${name}\` → ${content.length} char${content.length === 1 ? '' : 's'}\n`
      );
      resultCache.set(signature, content);
      pushTool(content);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const short = msg.split('\n')[0];
      options.stream.markdown(`❌ \`${name}\` failed: ${escapeBackticks(short)}\n`);
      // The tool wrapper already logged this at WARN; keep this quiet (debug).
      this.logger.debug(`agent: tool '${name}' failed: ${short}`);
      failedCache.set(signature, msg);
      pushTool(`Error: ${msg}`);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------

/** Stable signature for a tool call: name + args with sorted keys. */
function signatureOf(tc: ToolCall): string {
  let argPart = tc.function.arguments ?? '';
  try {
    argPart = JSON.stringify(sortKeys(JSON.parse(argPart)));
  } catch {
    /* keep raw */
  }
  return `${tc.function.name}::${argPart}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function serializeToolResult(result: vscode.LanguageModelToolResult): string {
  const parts: string[] = [];
  for (const c of result.content) {
    if (c instanceof vscode.LanguageModelTextPart) {
      parts.push(c.value);
    } else {
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
