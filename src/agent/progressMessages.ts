/**
 * Fun-but-corporate progress messages shown via `stream.progress(...)`
 * while the agent works, so the status line is alive instead of a static
 * "Thinking…". Messages vary by phase and by tool, and rotate so repeated
 * steps don't show the identical line.
 */

/** Messages shown while the model is reasoning between tool calls. */
const REASONING: string[] = [
  '🧠 Reasoning about the next step…',
  '💭 Thinking it through…',
  '🧠 Planning the approach…',
  '🤔 Weighing the options…',
  '🧠 Connecting the dots…',
];

/** Messages shown after a tool returns, before the next model call. */
const REVIEWING: string[] = [
  '📋 Reviewing what I found…',
  '🧩 Piecing it together…',
  '🔎 Analysing the results…',
  '📊 Synthesising the findings…',
  '🗃️ Cataloguing the details…',
];

/** Per-tool "doing it now" messages (keyed by llmName). */
const TOOL_MESSAGES: Record<string, string> = {
  read_file: '📖 Reading the source…',
  read_file_range: '📖 Reading the relevant lines…',
  list_directory: '🗂️ Browsing the folder…',
  find_files: '🗂️ Locating relevant files…',
  grep_workspace: '🔍 Combing through the codebase…',
  find_symbol: '🧭 Pinpointing the definition…',
  document_outline: '🗺️ Mapping the file structure…',
  find_references: '🔗 Tracing every usage…',
  go_to_definition: '🧭 Jumping to the definition…',
  write_file: '✍️ Drafting the new file…',
  apply_diff: '✏️ Preparing the change…',
  run_terminal_command: '⚙️ Running the command…',
  ask_followup_question: '🙋 Checking in with you…',
};

export function reasoningMessage(iteration: number): string {
  return REASONING[(iteration - 1) % REASONING.length];
}

export function reviewingMessage(counter: number): string {
  return REVIEWING[counter % REVIEWING.length];
}

export function toolMessage(llmName: string): string {
  return TOOL_MESSAGES[llmName] ?? `⚙️ Running ${llmName}…`;
}

/** Message shown when forcing a final summary at the iteration cap. */
export const FINALISING = '🧾 Wrapping up and summarising…';
