import * as vscode from 'vscode';
import type { LogLevel } from '../utils/logger';

export const CONFIG_SECTION = 'bosch-copilot';

export type CompletionStrategySetting = 'auto' | 'fim' | 'instruct';

/**
 * Maps to the four endpoint types documented at
 * https://inside-docupedia.bosch.com/confluence2/spaces/FARM/pages/961642929
 *
 * - `azure-openai`  — Azure OpenAI API (GPT, o-series, embeddings)
 * - `anthropic`     — Vertex AI native Anthropic (Claude rawPredict / streamRawPredict)
 * - `vertex-openai` — Vertex AI OpenAI-compatible (Google, DeepSeek, Meta, z.AI)
 * - `openai`        — Generic OpenAI-compatible (Ollama, LM Studio, vLLM)
 */
export type ApiTypeSetting =
  | 'azure-openai'
  | 'anthropic'
  | 'vertex-openai'
  | 'openai';

export interface BoschCopilotSettings {
  // --- Core / shared ---
  apiType: ApiTypeSetting;
  /** Base URL *without* any model/deployment path.
   *  Bosch BMF: `https://aoai-farm.bosch-temp.com/api`
   *  Local Ollama: `http://localhost:11434/v1` */
  endpoint: string;
  apiKey: string;
  /** HTTP header name used to send the API key. Defaults to 'Authorization' (value sent as 'Bearer <key>'). */
  apiKeyHeader: string;
  /** api-version query param appended to Azure OpenAI requests, e.g. '2025-04-01-preview'.
   *  Only used when apiType is 'azure-openai'. */
  apiVersion: string;
  chatModel: string;
  completionModel: string;
  maxContextTokens: number;
  temperature: number;
  enableInlineCompletions: boolean;
  enableTelemetry: boolean;
  logLevel: LogLevel;
  // --- Phase 2: inline completions ---
  completionStrategy: CompletionStrategySetting;
  completionDebounceMs: number;
  completionMaxTokens: number;
  completionTemperature: number;
  completionPrefixLines: number;
  completionSuffixLines: number;
  completionMaxContextChars: number;
  completionMultiline: boolean;
  completionCount: number;
  // --- Phase 3: chat + warmup ---
  prewarmOnActivation: boolean;
  // --- Phase 4: agent ---
  agentEnabled: boolean;
  agentMaxIterations: number;
}

export function readSettings(): BoschCopilotSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    apiType: cfg.get<ApiTypeSetting>('apiType', 'azure-openai'),
    endpoint: normalizeEndpoint(
      cfg.get<string>('endpoint', 'https://aoai-farm.bosch-temp.com/api')
    ),
    apiKey: cfg.get<string>('apiKey', ''),
    apiKeyHeader: cfg.get<string>('apiKeyHeader', 'Authorization'),
    apiVersion: cfg.get<string>('apiVersion', '2025-04-01-preview'),
    chatModel: cfg.get<string>(
      'chatModel',
      'askbosch-prod-farm-openai-gpt-4o-mini-2024-07-18'
    ),
    completionModel: cfg.get<string>(
      'completionModel',
      'gpt-5-nano-2025-08-07'
    ),
    maxContextTokens: cfg.get<number>('maxContextTokens', 8192),
    temperature: cfg.get<number>('temperature', 0.2),
    enableInlineCompletions: cfg.get<boolean>('enableInlineCompletions', true),
    enableTelemetry: cfg.get<boolean>('enableTelemetry', false),
    logLevel: cfg.get<LogLevel>('logLevel', 'info'),
    completionStrategy: cfg.get<CompletionStrategySetting>(
      'completionStrategy',
      'auto'
    ),
    completionDebounceMs: clamp(
      cfg.get<number>('completionDebounceMs', 250),
      0,
      2000
    ),
    completionMaxTokens: clamp(
      cfg.get<number>('completionMaxTokens', 256),
      16,
      2048
    ),
    completionTemperature: clamp(
      cfg.get<number>('completionTemperature', 0.1),
      0,
      2
    ),
    completionPrefixLines: clamp(
      cfg.get<number>('completionPrefixLines', 80),
      0,
      1000
    ),
    completionSuffixLines: clamp(
      cfg.get<number>('completionSuffixLines', 40),
      0,
      1000
    ),
    completionMaxContextChars: clamp(
      cfg.get<number>('completionMaxContextChars', 8000),
      500,
      64000
    ),
    completionMultiline: cfg.get<boolean>('completionMultiline', true),
    completionCount: clamp(cfg.get<number>('completionCount', 1), 1, 3),
    prewarmOnActivation: cfg.get<boolean>('prewarmOnActivation', true),
    agentEnabled: cfg.get<boolean>('agent.enabled', true),
    agentMaxIterations: clamp(cfg.get<number>('agent.maxIterations', 5), 1, 20),
  };
}

export function onSettingsChanged(
  listener: (settings: BoschCopilotSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(CONFIG_SECTION)) {
      listener(readSettings());
    }
  });
}

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : 'https://aoai-farm.bosch-temp.com/api';
}

/**
 * Build the full request URL for the configured API type + model.
 *
 * @param s     Current settings
 * @param model Model / deployment name (chatModel or completionModel)
 * @param path  API-path suffix, e.g. `'chat/completions'` or `'completions'`
 * @param opts  Extra options:
 *   - `anthropicMethod` — for `anthropic` type: `'rawPredict'` (default) or `'streamRawPredict'`
 */
export function buildRequestUrl(
  s: BoschCopilotSettings,
  model: string,
  path: string,
  opts?: { anthropicMethod?: string }
): string {
  const base = s.endpoint.replace(/\/+$/, '');

  switch (s.apiType) {
    // Endpoint #1 — Azure OpenAI API
    case 'azure-openai': {
      const url = `${base}/openai/deployments/${model}/${path}`;
      return s.apiVersion
        ? `${url}?api-version=${encodeURIComponent(s.apiVersion)}`
        : url;
    }

    // Endpoint #2 — Vertex AI native Anthropic
    case 'anthropic': {
      const method = opts?.anthropicMethod ?? 'rawPredict';
      // Encode path segments but keep @ literal (Vertex model IDs use it).
      const safePath = model
        .split('/')
        .map((seg) => encodeURIComponent(seg).replace(/%40/g, '@'))
        .join('/');
      return `${base}/google/v1/publishers/anthropic/models/${safePath}:${method}`;
    }

    // Endpoints #3 & #4 — Vertex AI OpenAI-compatible (Azure path)
    // model may include publisher prefix (e.g. 'google/gemini-2.5-flash');
    // URL uses just the model_id, body keeps the full string.
    case 'vertex-openai': {
      const modelId = model.includes('/') ? model.split('/').pop()! : model;
      return `${base}/openai/deployments/${modelId}/${path}`;
    }

    // Generic OpenAI-compatible (Ollama, LM Studio, vLLM)
    case 'openai':
    default:
      return `${base}/${path}`;
  }
}

/**
 * Return the correct JSON key for the max-tokens parameter.
 *
 * Azure OpenAI GPT-5+ models reject `max_tokens` and require
 * `max_completion_tokens`.  Anthropic uses `max_tokens`.
 * Local/generic OpenAI endpoints accept either — we prefer
 * `max_completion_tokens` for forward-compat.
 */
export function maxTokensKey(
  s: BoschCopilotSettings
): 'max_tokens' | 'max_completion_tokens' {
  return s.apiType === 'anthropic' ? 'max_tokens' : 'max_completion_tokens';
}

/**
 * Azure OpenAI reasoning models (o-series, GPT-5 nano) only accept
 * `temperature=1`. Sending any other value returns HTTP 400.
 * This helper returns `true` when the model is known to reject
 * custom temperature so callers can omit it from the request body.
 */
const REASONING_MODEL_RE = /\b(o1|o3|o4|gpt-5-nano|gpt-5\.?\d*-nano)\b/i;

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_RE.test(model);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
