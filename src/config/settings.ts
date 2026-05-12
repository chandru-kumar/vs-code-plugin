import * as vscode from 'vscode';
import type { LogLevel } from '../utils/logger';

export const CONFIG_SECTION = 'pilotcode';

export interface PilotCodeSettings {
  endpoint: string;
  apiKey: string;
  chatModel: string;
  completionModel: string;
  maxContextTokens: number;
  temperature: number;
  enableInlineCompletions: boolean;
  enableTelemetry: boolean;
  logLevel: LogLevel;
}

export function readSettings(): PilotCodeSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    endpoint: normalizeEndpoint(cfg.get<string>('endpoint', 'http://localhost:11434/v1')),
    apiKey: cfg.get<string>('apiKey', ''),
    chatModel: cfg.get<string>('chatModel', 'qwen2.5-coder:7b'),
    completionModel: cfg.get<string>('completionModel', 'qwen2.5-coder:1.5b-base'),
    maxContextTokens: cfg.get<number>('maxContextTokens', 8192),
    temperature: cfg.get<number>('temperature', 0.2),
    enableInlineCompletions: cfg.get<boolean>('enableInlineCompletions', true),
    enableTelemetry: cfg.get<boolean>('enableTelemetry', false),
    logLevel: cfg.get<LogLevel>('logLevel', 'info'),
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
