import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { BoschCopilotSettings } from '../config/settings';
import {
  buildRequestUrl,
  maxTokensKey,
  isReasoningModel,
} from '../config/settings';
import type { CompletionContext } from '../completions/contextGatherer';
import {
  buildFimPrompt,
  buildInstructMessages,
  cleanInstructOutput,
  resolveStrategy,
  fimStopTokensFor,
  type CompletionStrategy,
} from '../completions/promptStrategies';

export interface CompletionResult {
  text: string;
  strategy: CompletionStrategy;
  elapsedMs: number;
}

/**
 * Thrown when the endpoint reports the configured model does not exist.
 * The provider catches this specifically to surface a one-time
 * actionable warning to the user.
 */
export class ModelNotFoundError extends Error {
  constructor(public readonly modelName: string) {
    super(`Model '${modelName}' not found on the endpoint`);
    this.name = 'ModelNotFoundError';
  }
}

/**
 * Thrown when the endpoint reports the configured model does not support
 * tool / function calling. The agent loop catches this to fall back to a
 * plain (no-tools) chat completion.
 */
export class ToolsNotSupportedError extends Error {
  constructor(public readonly modelName: string) {
    super(`Model '${modelName}' does not support tools`);
    this.name = 'ToolsNotSupportedError';
  }
}

interface OpenAICompletionsResponse {
  choices?: Array<{ text?: string }>;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Thin client for the inline-completion side of an OpenAI-compatible
 * endpoint. Supports two strategies:
 *  - `fim`      -> POST /completions  with Qwen FIM tokens
 *  - `instruct` -> POST /chat/completions with a completion-style prompt
 *
 * Both are non-streaming: inline completions are short and VS Code wants a
 * fully-formed item. (Streaming chat lands in Phase 3.)
 */
export class CompletionClient {
  constructor(
    private readonly getSettings: () => BoschCopilotSettings,
    private readonly logger: Logger
  ) {}

  async complete(
    ctx: CompletionContext,
    token: vscode.CancellationToken,
    temperatureOverride?: number
  ): Promise<CompletionResult | undefined> {
    const s = this.getSettings();
    // Anthropic and Vertex-OpenAI models do not support FIM — always use instruct mode.
    const strategy =
      s.apiType === 'anthropic' || s.apiType === 'vertex-openai'
        ? 'instruct'
        : resolveStrategy(s.completionStrategy, s.completionModel);
    const started = Date.now();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const temperature = temperatureOverride ?? s.completionTemperature;

    try {
      const text =
        strategy === 'fim'
          ? await this.callFim(s, ctx, temperature, controller.signal)
          : s.apiType === 'anthropic'
            ? await this.callInstructAnthropic(
                s,
                ctx,
                temperature,
                controller.signal
              )
            : await this.callInstruct(s, ctx, temperature, controller.signal);
      return { text, strategy, elapsedMs: Date.now() - started };
    } catch (err) {
      if (controller.signal.aborted || token.isCancellationRequested) {
        return undefined;
      }
      this.logger.error('Completion request failed', err);
      return undefined;
    } finally {
      sub.dispose();
    }
  }

  private async callFim(
    s: BoschCopilotSettings,
    ctx: CompletionContext,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    const url = buildRequestUrl(s, s.completionModel, 'completions');
    const body: Record<string, unknown> = {
      model: s.completionModel,
      prompt: buildFimPrompt(ctx),
      [maxTokensKey(s)]: s.completionMaxTokens,
      stop: fimStopTokensFor(ctx.languageId),
      stream: false,
    };
    if (!isReasoningModel(s.completionModel)) {
      body.temperature = temperature;
    }
    const res = await this.post(url, body, s, signal);
    const json = (await res.json()) as OpenAICompletionsResponse;
    return json.choices?.[0]?.text ?? '';
  }

  private async callInstruct(
    s: BoschCopilotSettings,
    ctx: CompletionContext,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    const url = buildRequestUrl(s, s.completionModel, 'chat/completions');
    const body: Record<string, unknown> = {
      model: s.completionModel,
      messages: buildInstructMessages(ctx),
      [maxTokensKey(s)]: s.completionMaxTokens,
      stream: false,
    };
    if (!isReasoningModel(s.completionModel)) {
      body.temperature = temperature;
    }
    const res = await this.post(url, body, s, signal);
    const json = (await res.json()) as OpenAIChatResponse;
    return cleanInstructOutput(json.choices?.[0]?.message?.content ?? '');
  }

  private async callInstructAnthropic(
    s: BoschCopilotSettings,
    ctx: CompletionContext,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    const url = buildRequestUrl(s, s.completionModel, 'chat/completions', {
      anthropicMethod: 'rawPredict',
    });
    const messages = buildInstructMessages(ctx);
    // Extract system message (first message with role='system') for Anthropic.
    let system: string | undefined;
    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }> = [];
    for (const m of messages) {
      if (m.role === 'system') {
        system = system ? `${system}\n\n${m.content}` : m.content;
      } else if (m.role === 'user' || m.role === 'assistant') {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    const body: Record<string, unknown> = {
      anthropic_version: 'vertex-2023-10-16',
      messages: anthropicMessages,
      max_tokens: s.completionMaxTokens,
      temperature,
      stream: false,
    };
    if (system) {
      body.system = system;
    }
    const res = await this.post(url, body, s, signal);
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      json.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('') ?? '';
    return cleanInstructOutput(text);
  }

  private async post(
    url: string,
    body: unknown,
    s: BoschCopilotSettings,
    signal: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (s.apiKey) {
      if (s.apiKeyHeader.toLowerCase() === 'authorization') {
        headers.Authorization = `Bearer ${s.apiKey}`;
      } else {
        headers[s.apiKeyHeader] = s.apiKey;
      }
    }
    this.logger.trace(`POST ${url}`);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 404) {
        // Ollama / vLLM / LM Studio bodies all look roughly like:
        //   {"error":{"message":"model 'xxx' not found", ...}}
        // Extract the model name to throw a typed, user-actionable error.
        const m = errText.match(/model ['"]?([^'"\s]+)['"]?\s+not\s+found/i);
        if (m) {
          throw new ModelNotFoundError(m[1]);
        }
      }
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`
      );
    }
    return res;
  }
}
