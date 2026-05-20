import * as vscode from 'vscode';
import type { LogLevel } from '../utils/logger';

export const CONFIG_SECTION = 'pilotcode';

export type CompletionStrategySetting = 'auto' | 'fim' | 'instruct';

export interface PilotCodeSettings {
  // --- Core / shared ---
  endpoint: string;
  apiKey: string;
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

export function readSettings(): PilotCodeSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    endpoint: normalizeEndpoint(
      cfg.get<string>('endpoint', 'http://localhost:11434/v1')
    ),
    apiKey: cfg.get<string>('apiKey', ''),
    chatModel: cfg.get<string>('chatModel', 'qwen2.5-coder:7b'),
    completionModel: cfg.get<string>(
      'completionModel',
      'qwen2.5-coder:1.5b-base'
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
    agentMaxIterations: clamp(
      cfg.get<number>('agent.maxIterations', 5),
      1,
      20
    ),
  };
}

export function onSettingsChanged(
  listener: (settings: PilotCodeSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(CONFIG_SECTION)) {
      listener(readSettings());
    }
  });
}

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : 'http://localhost:11434/v1';
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
