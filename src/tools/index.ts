import * as vscode from 'vscode';
import type { ToolDefinition, ToolDescriptor } from '../agent/types';
import type { Logger } from '../utils/logger';

import { readFileTool } from './readFile';
import { listDirectoryTool } from './listDirectory';
import { grepWorkspaceTool } from './grepWorkspace';
import { writeFileTool } from './writeFile';
import { applyDiffTool } from './applyDiff';
import { runTerminalTool } from './runTerminal';

/** Canonical list of all Bosch-CoPilot-provided tools, in display order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: Array<ToolDefinition<any>> = [
  readFileTool,
  listDirectoryTool,
  grepWorkspaceTool,
  writeFileTool,
  applyDiffTool,
  runTerminalTool,
];

/**
 * Registers every Bosch-CoPilot tool with VS Code's Language Model Tools API
 * and returns the static descriptors (used to advertise the tools to the
 * LLM in agent-loop requests). Disposes cleanly with the extension.
 */
export function registerAllTools(
  context: vscode.ExtensionContext,
  logger: Logger
): ToolDescriptor[] {
  const descriptors: ToolDescriptor[] = [];
  for (const def of ALL_TOOLS) {
    const disposable = vscode.lm.registerTool(
      def.descriptor.vsCodeName,
      def.factory()
    );
    context.subscriptions.push(disposable);
    descriptors.push(def.descriptor);
  }
  logger.info(
    `Registered ${descriptors.length} tool(s): ${descriptors.map((d) => d.llmName).join(', ')}`
  );
  return descriptors;
}
