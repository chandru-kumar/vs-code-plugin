import type * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

/**
 * Static metadata about one tool — used to describe it to the LLM and to
 * map a tool-call name back to its VS-Code-registered implementation.
 */
export interface ToolDescriptor {
  /** Name as seen by the LLM (no prefix), e.g. `read_file`. */
  llmName: string;
  /** Name registered with `vscode.lm.registerTool`, e.g. `bosch_copilot_read_file`. */
  vsCodeName: string;
  /** Description sent to the model (be specific — the model uses this to pick). */
  description: string;
  /** OpenAI-style JSON-Schema for the arguments. */
  parameters: object;
  /** True for tools that mutate state — used for UX hints. */
  destructive: boolean;
}

/**
 * A descriptor plus a factory that produces the runtime tool implementation.
 * Each tool module exports one of these.
 *
 * The factory receives the shared {@link Logger}; tools that don't need it
 * may ignore the argument (a zero-arg factory is still assignable here).
 */
export interface ToolDefinition<TInput> {
  descriptor: ToolDescriptor;
  factory: (logger: Logger) => vscode.LanguageModelTool<TInput>;
}
