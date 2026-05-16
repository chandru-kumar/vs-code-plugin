import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import type { PilotCodeSettings } from '../config/settings';
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
    private readonly getSettings: () => PilotCodeSettings,
    private readonly logger: Logger
  ) {}

  async complete(
    ctx: CompletionContext,
    token: vscode.CancellationToken,
    temperatureOverride?: number
  ): Promise<CompletionResult | undefined> {
    const s = this.getSettings();
    const strategy = resolveStrategy(s.completionStrategy, s.completionModel);
    const started = Date.now();
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const temperature = temperatureOverride ?? s.completionTemperature;

    try {
      const text =
        strategy === 'fim'
          ? await this.callFim(s, ctx, temperature, controller.signal)
          : await this.callInstruct(s, ctx, temperature, controller.signal);
      return { text, strategy, elapsedMs: Date.now() - started };
    } catch (err) {
      if (controller.signal.aborted || token.isCancellationRequested) {
        return undefined; // cancelled — caller treats this as "no result"
      }
      this.logger.error('Completion request failed', err);
      return undefined;
    } finally {
      sub.dispose();
    }
  }

  private async callFim(
    s: PilotCodeSettings,
    ctx: CompletionContext,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    const url = `${s.endpoint}/completions`;
    const body = {
      model: s.completionModel,
      prompt: buildFimPrompt(ctx),
      max_tokens: s.completionMaxTokens,
      temperature,
      stop: fimStopTokensFor(ctx.languageId),
      stream: false,
    };
    const res = await this.post(url, body, s.apiKey, signal);
    const json = (await res.json()) as OpenAICompletionsResponse;
    return json.choices?.[0]?.text ?? '';
  }

  private async callInstruct(
    s: PilotCodeSettings,
    ctx: CompletionContext,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    const url = `${s.endpoint}/chat/completions`;
    const body = {
      model: s.completionModel,
      messages: buildInstructMessages(ctx),
      max_tokens: s.completionMaxTokens,
      temperature,
      stream: false,
    };
    const res = await this.post(url, body, s.apiKey, signal);
    const json = (await res.json()) as OpenAIChatResponse;
    return cleanInstructOutput(json.choices?.[0]?.message?.content ?? '');
  }

  private async post(
    url: string,
    body: unknown,
    apiKey: string,
    signal: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
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
        const m = errText.match(
          /model ['"]?([^'"\s]+)['"]?\s+not\s+found/i
        );
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
