import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { BoschCopilotSettings } from '../config/settings';
import type { ChatMessage, OpenAITool, ToolCall } from './types';
import { ModelNotFoundError, ToolsNotSupportedError } from './completionClient';

/**
 * One incremental piece of a streamed chat response.
 */
export interface StreamChunk {
  /** Newly arrived text. Empty on the terminal chunk. */
  delta: string;
  /** True on the final chunk (after which the iterator returns). */
  done: boolean;
}

export interface ChatStreamOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatNonStreamOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: OpenAITool[];
  toolChoice?:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } };
}

export interface ChatNonStreamResult {
  /** Assistant message returned by the model. May include `tool_calls`. */
  message: ChatMessage;
  /** Whatever the model reported as finish_reason (`stop`, `tool_calls`, …). */
  finishReason: string | undefined;
  elapsedMs: number;
}

/**
 * Streaming chat client for OpenAI-compatible endpoints (Ollama / LM Studio
 * / vLLM / OpenAI / etc.). Uses POST /chat/completions with `stream: true`
 * and parses the Server-Sent-Events response incrementally.
 *
 * - Honours `CancellationToken` end-to-end: the HTTP request is aborted
 *   and the body reader is cancelled when the token fires.
 * - Re-throws {@link ModelNotFoundError} for typed handling upstream.
 * - Yields only non-empty deltas; emits a single trailing `{ done: true }`.
 */
export class ChatClient {
  constructor(
    private readonly getSettings: () => BoschCopilotSettings,
    private readonly logger: Logger
  ) {}

  /**
   * Non-streaming chat request. Used by the agent loop, which needs the
   * full assistant message (with `tool_calls`, if any) before deciding
   * whether to invoke tools and continue, or to render the final answer.
   *
   * Same end-to-end cancellation guarantees as `stream()`.
   */
  async chat(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatNonStreamOptions = {}
  ): Promise<ChatNonStreamResult> {
    const s = this.getSettings();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const started = Date.now();

    const url = `${s.endpoint}/chat/completions`;
    const body: Record<string, unknown> = {
      model: s.chatModel,
      messages,
      temperature: options.temperature ?? s.temperature,
      max_tokens: options.maxTokens ?? s.maxContextTokens,
      stream: false,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (s.apiKey) {
      headers.Authorization = `Bearer ${s.apiKey}`;
    }

    // Abort after 5 min to prevent indefinite "Working…" spinner on
    // slow local models. Generous enough for 7B+ with tool schemas.
    const timeoutId = setTimeout(() => {
      this.logger.warn('chat.nonstream: request timed out after 300 s');
      controller.abort();
    }, 300_000);

    this.logger.info(
      `chat.nonstream: POST ${url} (model=${s.chatModel}, ${messages.length} msgs` +
        `${options.tools ? `, ${options.tools.length} tools` : ''}, ` +
        `temp=${options.temperature ?? s.temperature}, max_tokens=${options.maxTokens ?? s.maxContextTokens})`
    );

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      }).catch((err) => {
        // Distinguish our timeout abort from a user cancellation.
        if (err?.name === 'AbortError' && !token.isCancellationRequested) {
          throw new Error(
            `Chat request timed out after 300 s. ` +
              `The model may be overloaded — try a shorter prompt or a faster model.`
          );
        }
        throw err;
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if (res.status === 404) {
          const m = errText.match(/model ['"]?([^'"\s]+)['"]?\s+not\s+found/i);
          if (m) {
            throw new ModelNotFoundError(m[1]);
          }
        }
        if (res.status === 400 && /does not support tools/i.test(errText)) {
          throw new ToolsNotSupportedError(s.chatModel);
        }
        throw new Error(
          `HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`
        );
      }

      const json = (await res.json()) as {
        choices?: Array<{
          message?: {
            role?: string;
            content?: string | null;
            tool_calls?: ToolCall[];
          };
          finish_reason?: string;
        }>;
      };

      const choice = json.choices?.[0];
      const message: ChatMessage = {
        role: 'assistant',
        content: choice?.message?.content ?? '',
        ...(choice?.message?.tool_calls?.length
          ? { tool_calls: choice.message.tool_calls }
          : {}),
      };

      const elapsed = Date.now() - started;
      this.logger.info(
        `chat.nonstream: response in ${elapsed}ms — ` +
          `finish_reason=${choice?.finish_reason ?? 'none'}, ` +
          `content_len=${message.content.length}, ` +
          `tool_calls=${message.tool_calls?.length ?? 0}`
      );

      return {
        message,
        finishReason: choice?.finish_reason,
        elapsedMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeoutId);
      sub.dispose();
    }
  }

  async *stream(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatStreamOptions = {}
  ): AsyncGenerator<StreamChunk, void, void> {
    const s = this.getSettings();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());

    // Timeout for the initial connection + first byte (model loading).
    // If the model needs to be loaded from disk this can take 30-60s on slow
    // hardware, but anything beyond 120s likely means Ollama is stuck.
    const streamTimeoutId = setTimeout(() => {
      this.logger.warn('chat.stream: no response after 120 s — aborting');
      controller.abort();
    }, 120_000);

    const url = `${s.endpoint}/chat/completions`;
    const body = {
      model: s.chatModel,
      messages,
      temperature: options.temperature ?? s.temperature,
      max_tokens: options.maxTokens ?? s.maxContextTokens,
      stream: true,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (s.apiKey) {
      headers.Authorization = `Bearer ${s.apiKey}`;
    }

    this.logger.info(
      `chat.stream: POST ${url} (model=${s.chatModel}, ${messages.length} msgs, ` +
        `temp=${options.temperature ?? s.temperature}, max_tokens=${options.maxTokens ?? s.maxContextTokens})`
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(streamTimeoutId);
      this.logger.debug(`chat.stream: connected — HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(streamTimeoutId);
      sub.dispose();
      if (controller.signal.aborted && !token.isCancellationRequested) {
        throw new Error(
          `Streaming request timed out waiting for the model to respond (120 s). ` +
            `The model may still be loading into memory — try again in a moment, or use a smaller model.`
        );
      }
      if (controller.signal.aborted) {
        return;
      }
      this.logger.error('chat.stream: fetch failed', err);
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      sub.dispose();
      if (res.status === 404) {
        const m = errText.match(/model ['"]?([^'"\s]+)['"]?\s+not\s+found/i);
        if (m) {
          throw new ModelNotFoundError(m[1]);
        }
      }
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`
      );
    }

    if (!res.body) {
      sub.dispose();
      throw new Error('Chat response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        if (token.isCancellationRequested) {
          await reader.cancel().catch(() => {
            /* ignore */
          });
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          // Flush any partial buffered message (rare with SSE).
          if (buffer.trim()) {
            for (const chunk of parseSSEBlock(buffer)) {
              yield chunk;
              if (chunk.done) {
                return;
              }
            }
          }
          yield { delta: '', done: true };
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line (\n\n).
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          for (const chunk of parseSSEBlock(event)) {
            yield chunk;
            if (chunk.done) {
              return;
            }
          }
        }
      }
    } finally {
      sub.dispose();
    }
  }
}

/**
 * Parses one SSE event block (one or more `data:` lines). Yields each
 * decoded chat delta. A `data: [DONE]` line yields `{ done: true }`.
 */
function* parseSSEBlock(block: string): Generator<StreamChunk, void, void> {
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('data:')) {
      continue;
    }
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      yield { delta: '', done: true };
      return;
    }
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string };
          finish_reason?: string | null;
        }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      const finish = parsed.choices?.[0]?.finish_reason;
      if (delta) {
        yield { delta, done: false };
      }
      if (finish) {
        yield { delta: '', done: true };
        return;
      }
    } catch {
      // Malformed line — skip silently. Ollama very occasionally emits
      // keepalives or partial JSON during heavy load.
    }
  }
}
