import * as vscode from 'vscode';
import type { ToolDefinition, ToolDescriptor } from '../agent/types';
import type { Logger } from '../utils/logger';

// File / content tools
import { readFileTool } from './readFile';
import { readFileRangeTool } from './readFileRange';
import { listDirectoryTool } from './listDirectory';
import { findFilesTool } from './findFiles';
import { grepWorkspaceTool } from './grepWorkspace';
// Code-navigation tools (language-server backed)
import { findSymbolTool } from './findSymbol';
import { documentOutlineTool } from './documentOutline';
import { findReferencesTool } from './findReferences';
import { goToDefinitionTool } from './goToDefinition';
// Mutating tools (staged for diff review)
import { replaceLinesTool } from './replaceLines';
import { applyDiffTool } from './applyDiff';
import { writeFileTool } from './writeFile';
import { runTerminalTool } from './runTerminal';
// Interaction
import { askFollowupTool } from './askFollowup';

/** Canonical list of all Bosch-CoPilot-provided tools, in display order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: Array<ToolDefinition<any>> = [
  // read / explore
  readFileTool,
  readFileRangeTool,
  listDirectoryTool,
  findFilesTool,
  grepWorkspaceTool,
  // code navigation / flow analysis
  findSymbolTool,
  documentOutlineTool,
  findReferencesTool,
  goToDefinitionTool,
  // mutate (staged for diff review)
  replaceLinesTool,
  applyDiffTool,
  writeFileTool,
  runTerminalTool,
  // interaction
  askFollowupTool,
];

/**
 * Registers every Bosch-CoPilot tool with VS Code's Language Model Tools API
 * and returns the static descriptors (used to advertise the tools to the
 * LLM in agent-loop requests). Disposes cleanly with the extension.
 *
 * Every tool's `invoke` is wrapped with uniform logging (args preview,
 * elapsed time, result size, errors) so the Output channel shows a complete
 * trace of tool activity — including tools invoked directly via `#tool`
 * references outside the agent loop.
 */
export function registerAllTools(
  context: vscode.ExtensionContext,
  logger: Logger
): ToolDescriptor[] {
  const descriptors: ToolDescriptor[] = [];
  for (const def of ALL_TOOLS) {
    const impl = def.factory(logger);
    const wrapped = wrapWithLogging(impl, def.descriptor, logger);
    const disposable = vscode.lm.registerTool(def.descriptor.vsCodeName, wrapped);
    context.subscriptions.push(disposable);
    descriptors.push(def.descriptor);
    logger.debug(
      `tool registered: ${def.descriptor.llmName} ` +
        `(${def.descriptor.vsCodeName}, destructive=${def.descriptor.destructive})`
    );
  }
  logger.info(
    `Registered ${descriptors.length} tool(s): ` +
      descriptors.map((d) => d.llmName).join(', ')
  );
  return descriptors;
}

/**
 * Wrap a tool so each invocation is logged with timing, an arguments
 * preview, and the result size. Errors are logged and re-thrown so the
 * agent loop / VS Code still see them.
 */
function wrapWithLogging<TInput>(
  tool: vscode.LanguageModelTool<TInput>,
  descriptor: ToolDescriptor,
  logger: Logger
): vscode.LanguageModelTool<TInput> {
  const name = descriptor.llmName;
  return {
    async invoke(options, token) {
      const started = Date.now();
      logger.info(`tool:${name} → invoke ${previewArgs(options.input)}`);
      try {
        const result = await tool.invoke(options, token);
        if (!result) {
          logger.warn(`tool:${name} returned no result`);
          return new vscode.LanguageModelToolResult([]);
        }
        const size = measureResultChars(result);
        logger.info(
          `tool:${name} ✓ ok (${Date.now() - started}ms, ${size} chars)`
        );
        return result;
      } catch (err) {
        // Tool failures are usually recoverable (the agent reads the error
        // and retries differently), so log at WARN with just the message —
        // no alarming stack dumps in the user's Output channel.
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `tool:${name} ✗ failed (${Date.now() - started}ms): ${firstLine(msg)}`
        );
        throw err;
      }
    },
    // Preserve confirmation behaviour: only expose prepareInvocation when
    // the underlying tool defines it (VS Code keys off its presence).
    prepareInvocation: tool.prepareInvocation
      ? (options, token) => tool.prepareInvocation!(options, token)
      : undefined,
  };
}

function previewArgs(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? s.slice(0, 197) + '…' : s;
  } catch {
    return '[unserialisable args]';
  }
}

/** First line of a (possibly multi-line) message, for compact logging. */
function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  return nl >= 0 ? s.slice(0, nl) + ' …' : s;
}

function measureResultChars(result: vscode.LanguageModelToolResult): number {
  let n = 0;
  for (const part of result.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      n += part.value.length;
    }
  }
  return n;
}
