import type { CompletionContext } from './contextGatherer';
import type { CompletionStrategySetting } from '../config/settings';

/** The concrete strategy actually used for a request (never 'auto'). */
export type CompletionStrategy = 'fim' | 'instruct';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Resolves the `auto` setting to a concrete strategy based on the model
 * name. Base / code-tuned models are trained with fill-in-the-middle
 * tokens; generic chat models are not, so we fall back to instruct
 * prompting for them.
 */
export function resolveStrategy(
  setting: CompletionStrategySetting,
  modelName: string
): CompletionStrategy {
  if (setting === 'fim' || setting === 'instruct') {
    return setting;
  }
  const lower = modelName.toLowerCase();
  const fimHints = [
    'base',
    'coder',
    'starcoder',
    'codellama',
    'deepseek-coder',
    'codegemma',
    'codestral',
  ];
  return fimHints.some((h) => lower.includes(h)) ? 'fim' : 'instruct';
}

// --- Fill-in-the-middle (Qwen2.5/3-Coder family) -------------------------

const FIM_PREFIX = '<|fim_prefix|>';
const FIM_SUFFIX = '<|fim_suffix|>';
const FIM_MIDDLE = '<|fim_middle|>';

/** Stop sequences that should terminate a FIM completion. */
export const FIM_STOP_TOKENS: string[] = [
  '<|endoftext|>',
  '<|fim_prefix|>',
  '<|fim_suffix|>',
  '<|fim_middle|>',
  '<|fim_pad|>',
  '<|repo_name|>',
  '<|file_sep|>',
];

export function buildFimPrompt(ctx: CompletionContext): string {
  return `${FIM_PREFIX}${ctx.prefix}${FIM_SUFFIX}${ctx.suffix}${FIM_MIDDLE}`;
}

// --- Instruct prompting (generic chat models) ----------------------------

export function buildInstructMessages(ctx: CompletionContext): ChatMessage[] {
  const system =
    'You are an expert code-completion engine embedded in a code editor. ' +
    'You will receive a source file containing exactly one <CURSOR> marker. ' +
    'Reply with ONLY the raw code that should be inserted at <CURSOR>. ' +
    'Never repeat code that already appears before or after the cursor. ' +
    'Never wrap your answer in markdown code fences. ' +
    'Never add explanations, comments about the task, or trailing prose. ' +
    'Preserve the file’s existing indentation style. ' +
    'If no sensible completion exists, reply with an empty response.';

  const user =
    `Language: ${ctx.languageId}\n` +
    `File: ${ctx.fileName}\n\n` +
    'Complete the code at <CURSOR>:\n\n' +
    `${ctx.prefix}<CURSOR>${ctx.suffix}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Instruct models sometimes ignore the "no fences" rule. Strip a single
 * surrounding markdown code fence if present.
 */
export function cleanInstructOutput(raw: string): string {
  const fence = raw.match(
    /^\s*```[a-zA-Z0-9+#.-]*\r?\n([\s\S]*?)\r?\n?```\s*$/
  );
  return fence ? fence[1] : raw;
}

// --- Shared post-processing ---------------------------------------------

/**
 * FIM models occasionally regenerate part of the suffix. If the completion
 * ends with text that already begins the suffix, trim that overlap.
 */
export function trimSuffixOverlap(completion: string, suffix: string): string {
  const max = Math.min(completion.length, suffix.length);
  for (let len = max; len >= 3; len--) {
    if (completion.endsWith(suffix.slice(0, len))) {
      return completion.slice(0, completion.length - len);
    }
  }
  return completion;
}
