import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { BoschCopilotSettings } from '../config/settings';
import {
  buildRequestUrl,
  maxTokensKey,
  isReasoningModel,
} from '../config/settings';
import type { ChatMessage, OpenAITool, ToolCall } from './types';
import { ModelNotFoundError, ToolsNotSupportedError } from './completionClient';

// -------------------------------------------------------------------------
// Anthropic API types
// -------------------------------------------------------------------------

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: object;
}
interface AnthropicRequestBody {
  anthropic_version: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  tools?: AnthropicTool[];
  stream?: boolean;
}
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// -------------------------------------------------------------------------
// Anthropic translation helpers
// -------------------------------------------------------------------------

/**
 * Convert OpenAI-style messages to Anthropic format.
 * - Extracts `system` messages to a top-level string parameter.
 * - Merges consecutive `tool` (role='tool') messages into a single user turn
 *   with `tool_result` content blocks, as required by the Anthropic API.
 */
function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = system ? `${system}\n\n${msg.content}` : msg.content;
      continue;
    }

    if (msg.role === 'tool') {
      const resultBlock: AnthropicToolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id ?? '',
        content: msg.content,
      };
      // Merge consecutive tool results into the same user message.
      const prev = result[result.length - 1];
      if (
        prev &&
        prev.role === 'user' &&
        Array.isArray(prev.content) &&
        (prev.content as AnthropicContentBlock[]).every(
          (b) => b.type === 'tool_result'
        )
      ) {
        (prev.content as AnthropicContentBlock[]).push(resultBlock);
      } else {
        result.push({ role: 'user', content: [resultBlock] });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const content: AnthropicContentBlock[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments) as Record<
              string,
              unknown
            >;
          } catch {
            // leave empty on invalid JSON
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      result.push({ role: 'assistant', content });
      continue;
    }

    // user message
    result.push({ role: 'user', content: msg.content });
  }

  return { system, messages: result };
}

/** Convert OpenAI-style tool descriptors to Anthropic format. */
function toAnthropicTools(tools: OpenAITool[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Parse an Anthropic non-streaming response into an OpenAI-style message
 * and finish reason.
 */
function fromAnthropicResponse(response: AnthropicResponse): {
  message: ChatMessage;
  finishReason: string | undefined;
} {
  let text = '';
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      text += (block as AnthropicTextBlock).text;
    } else if (block.type === 'tool_use') {
      const tu = block as AnthropicToolUseBlock;
      toolCalls.push({
        id: tu.id,
        type: 'function',
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      });
    }
  }

  const message: ChatMessage = {
    role: 'assistant',
    content: text,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  const finishReason =
    response.stop_reason === 'end_turn'
      ? 'stop'
      : response.stop_reason === 'tool_use'
        ? 'tool_calls'
        : (response.stop_reason ?? undefined);

  return { message, finishReason };
}

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
 * Chat client supporting both OpenAI-compatible endpoints (Ollama / LM Studio
 * / vLLM / OpenAI) and the Anthropic Messages API (Bosch hosted / Vertex AI).
 * Routing is controlled by `bosch-copilot.apiType`.
 *
 * - Honours `CancellationToken` end-to-end.
 * - Re-throws {@link ModelNotFoundError} for typed handling upstream.
 * - Yields only non-empty deltas; emits a single trailing `{ done: true }`.
 */
export class ChatClient {
  constructor(
    private readonly getSettings: () => BoschCopilotSettings,
    private readonly logger: Logger
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Non-streaming chat. Routes to Anthropic or OpenAI implementation based
   * on `apiType` setting.
   */
  async chat(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatNonStreamOptions = {}
  ): Promise<ChatNonStreamResult> {
    const s = this.getSettings();
    if (s.apiType === 'anthropic') {
      return this.chatAnthropic(messages, token, options);
    }
    return this.chatOpenAI(messages, token, options);
  }

  /**
   * Streaming chat. Routes to Anthropic or OpenAI implementation based on
   * `apiType` setting.
   */
  async *stream(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatStreamOptions = {}
  ): AsyncGenerator<StreamChunk, void, void> {
    const s = this.getSettings();
    if (s.apiType === 'anthropic') {
      yield* this.streamAnthropic(messages, token, options);
    } else {
      yield* this.streamOpenAI(messages, token, options);
    }
  }

  // -----------------------------------------------------------------------
  // Anthropic implementation
  // -----------------------------------------------------------------------

  private async chatAnthropic(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatNonStreamOptions
  ): Promise<ChatNonStreamResult> {
    const s = this.getSettings();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const started = Date.now();

    const { system, messages: anthropicMessages } =
      toAnthropicMessages(messages);

    const body: AnthropicRequestBody = {
      anthropic_version: 'vertex-2023-10-16',
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? s.maxContextTokens,
      temperature: options.temperature ?? s.temperature,
      stream: false,
    };
    if (system) {
      body.system = system;
    }
    if (options.tools && options.tools.length > 0) {
      body.tools = toAnthropicTools(options.tools);
    }

    const url = buildRequestUrl(s, s.chatModel, 'chat/completions', {
      anthropicMethod: 'rawPredict',
    });
    this.logger.info(
      `chat.anthropic: POST ${url} (${anthropicMessages.length} msgs` +
        `${body.tools ? `, ${body.tools.length} tools` : ''})`
    );

    const timeoutId = setTimeout(() => {
      this.logger.warn('chat.anthropic: request timed out after 300 s');
      controller.abort();
    }, 300_000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.anthropicHeaders(s),
        body: JSON.stringify(body),
        signal: controller.signal,
      }).catch((err) => {
        if (err?.name === 'AbortError' && !token.isCancellationRequested) {
          throw new Error(
            'Chat request timed out after 300 s. The model may be overloaded.'
          );
        }
        throw err;
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(
          `HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`
        );
      }

      const json = (await res.json()) as AnthropicResponse;
      const { message, finishReason } = fromAnthropicResponse(json);
      const elapsed = Date.now() - started;

      this.logger.info(
        `chat.anthropic: response in ${elapsed}ms — ` +
          `stop_reason=${json.stop_reason ?? 'none'}, ` +
          `content_len=${message.content.length}, ` +
          `tool_calls=${message.tool_calls?.length ?? 0}`
      );

      return { message, finishReason, elapsedMs: elapsed };
    } finally {
      clearTimeout(timeoutId);
      sub.dispose();
    }
  }

  private async *streamAnthropic(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatStreamOptions
  ): AsyncGenerator<StreamChunk, void, void> {
    const s = this.getSettings();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());

    const streamTimeoutId = setTimeout(() => {
      this.logger.warn(
        'chat.anthropic.stream: no response after 120 s — aborting'
      );
      controller.abort();
    }, 120_000);

    const { system, messages: anthropicMessages } =
      toAnthropicMessages(messages);
    const body: AnthropicRequestBody = {
      anthropic_version: 'vertex-2023-10-16',
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? s.maxContextTokens,
      temperature: options.temperature ?? s.temperature,
      stream: true,
    };
    if (system) {
      body.system = system;
    }

    const url = buildRequestUrl(s, s.chatModel, 'chat/completions', {
      anthropicMethod: 'streamRawPredict',
    });
    this.logger.info(
      `chat.anthropic.stream: POST ${url} (${anthropicMessages.length} msgs)`
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...this.anthropicHeaders(s), Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(streamTimeoutId);
    } catch (err) {
      clearTimeout(streamTimeoutId);
      sub.dispose();
      if (controller.signal.aborted && !token.isCancellationRequested) {
        throw new Error(
          'Streaming request timed out waiting for the model to respond (120 s).'
        );
      }
      if (controller.signal.aborted) {
        return;
      }
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      sub.dispose();
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`
      );
    }

    if (!res.body) {
      sub.dispose();
      throw new Error('Anthropic stream response has no body');
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
          if (buffer.trim()) {
            for (const chunk of parseAnthropicSSEBlock(buffer)) {
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
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          for (const chunk of parseAnthropicSSEBlock(event)) {
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

  private anthropicHeaders(s: BoschCopilotSettings): Record<string, string> {
    return this.buildHeaders(s);
  }

  /**
   * Build request headers for any endpoint.
   * If `apiKeyHeader` is 'Authorization' (default), the value is sent as
   * `Bearer <key>`. For any other header name (e.g. the Bosch platform's
   * `genaiplatform-farm-subscription-key`) the key is sent verbatim.
   */
  private buildHeaders(
    s: BoschCopilotSettings,
    extra?: Record<string, string>
  ): Record<string, string> {
    if (!s.apiKey) {
      this.logger.warn(
        'chat: no API key configured — set bosch-copilot.apiKey, ' +
          'otherwise the endpoint will return 401.'
      );
    } else {
      const k = s.apiKey;
      const masked =
        k.length > 8
          ? `${k.slice(0, 4)}…${k.slice(-4)} (len=${k.length})`
          : '*** (too short)';
      this.logger.debug(
        `chat: apiKey ${masked} via header '${s.apiKeyHeader}'`
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (s.apiKey) {
      if (s.apiKeyHeader.toLowerCase() === 'authorization') {
        headers.Authorization = `Bearer ${s.apiKey}`;
      } else {
        headers[s.apiKeyHeader] = s.apiKey;
      }
    }
    return headers;
  }

  // -----------------------------------------------------------------------
  // OpenAI implementation
  // -----------------------------------------------------------------------

  /**
   * Non-streaming chat request (OpenAI-compatible endpoint).
   */
  private async chatOpenAI(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatNonStreamOptions
  ): Promise<ChatNonStreamResult> {
    const s = this.getSettings();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const started = Date.now();

    const url = buildRequestUrl(s, s.chatModel, 'chat/completions');
    const body: Record<string, unknown> = {
      model: s.chatModel,
      messages,
      [maxTokensKey(s)]: options.maxTokens ?? s.maxContextTokens,
      stream: false,
    };
    if (!isReasoningModel(s.chatModel)) {
      body.temperature = options.temperature ?? s.temperature;
    }
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    const headers: Record<string, string> = this.buildHeaders(s);

    // Abort after 5 min to prevent indefinite "Working…" spinner on
    // slow local models. Generous enough for 7B+ with tool schemas.
    const timeoutId = setTimeout(() => {
      this.logger.warn('chat.nonstream: request timed out after 300 s');
      controller.abort();
    }, 300_000);

    this.logger.info(
      `chat.nonstream: POST ${url} (model=${s.chatModel}, ${messages.length} msgs` +
        `${options.tools ? `, ${options.tools.length} tools` : ''}, ` +
        `temp=${options.temperature ?? s.temperature}, ${maxTokensKey(s)}=${options.maxTokens ?? s.maxContextTokens})`
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

  private async *streamOpenAI(
    messages: ChatMessage[],
    token: vscode.CancellationToken,
    options: ChatStreamOptions
  ): AsyncGenerator<StreamChunk, void, void> {
    const s = this.getSettings();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());

    const streamTimeoutId = setTimeout(() => {
      this.logger.warn('chat.stream: no response after 120 s — aborting');
      controller.abort();
    }, 120_000);

    const url = buildRequestUrl(s, s.chatModel, 'chat/completions');
    const body: Record<string, unknown> = {
      model: s.chatModel,
      messages,
      [maxTokensKey(s)]: options.maxTokens ?? s.maxContextTokens,
      stream: true,
    };
    if (!isReasoningModel(s.chatModel)) {
      body.temperature = options.temperature ?? s.temperature;
    }

    const headers: Record<string, string> = this.buildHeaders(s, {
      Accept: 'text/event-stream',
    });

    this.logger.info(
      `chat.stream: POST ${url} (model=${s.chatModel}, ${messages.length} msgs, ` +
        `temp=${options.temperature ?? s.temperature}, ${maxTokensKey(s)}=${options.maxTokens ?? s.maxContextTokens})`
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
 * Parses one Anthropic SSE event block. Yields text deltas from
 * `content_block_delta` events and a terminal `{ done: true }` on
 * `message_stop`.
 */
function* parseAnthropicSSEBlock(
  block: string
): Generator<StreamChunk, void, void> {
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data) {
      continue;
    }
    try {
      const parsed = JSON.parse(data) as {
        type?: string;
        delta?: { type?: string; text?: string };
        index?: number;
      };
      if (
        parsed.type === 'content_block_delta' &&
        parsed.delta?.type === 'text_delta' &&
        parsed.delta.text
      ) {
        yield { delta: parsed.delta.text, done: false };
      } else if (parsed.type === 'message_stop') {
        yield { delta: '', done: true };
        return;
      }
    } catch {
      // skip malformed lines
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
