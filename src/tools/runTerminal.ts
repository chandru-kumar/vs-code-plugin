import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../agent/types';
import { textResult, truncateForModel } from './util';

const execAsync = promisify(exec);

interface RunTerminalInput {
  command: string;
  /** Optional working dir, workspace-relative. Defaults to the workspace root. */
  cwd?: string;
  /** Optional timeout in seconds (default 30, max 120). */
  timeoutSeconds?: number;
}

class RunTerminalTool implements vscode.LanguageModelTool<RunTerminalInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunTerminalInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { command } = options.input;
    if (!command || command.trim().length === 0) {
      throw new Error('run_terminal_command: `command` must be non-empty.');
    }

    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      throw new Error('No workspace open — cannot run a terminal command.');
    }
    const cwdRel = options.input.cwd ?? '.';
    const cwd = vscode.Uri.joinPath(ws.uri, cwdRel).fsPath;
    const timeoutMs =
      Math.min(Math.max(options.input.timeoutSeconds ?? 30, 1), 120) * 1000;

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      const result = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024, // 2 MB
        windowsHide: true,
      });
      stdout = result.stdout?.toString() ?? '';
      stderr = result.stderr?.toString() ?? '';
    } catch (err) {
      const e = err as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
      };
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
      exitCode =
        typeof e.code === 'number' ? e.code : e.code === 'ETIMEDOUT' ? 124 : 1;
      if (e.killed || e.signal) {
        stderr =
          (stderr ? stderr + '\n' : '') +
          `[killed by signal ${e.signal ?? 'unknown'}]`;
      }
    }

    const body =
      `$ ${command}\n` +
      `(cwd: ${cwdRel}, exit code: ${exitCode})\n\n` +
      `--- stdout ---\n${stdout || '(empty)'}\n\n` +
      `--- stderr ---\n${stderr || '(empty)'}`;
    return textResult(truncateForModel(body));
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunTerminalInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Running \`${options.input.command}\``,
      confirmationMessages: {
        title: 'Run terminal command?',
        message: new vscode.MarkdownString(
          `Run **\`${options.input.command}\`**` +
            (options.input.cwd ? ` in \`${options.input.cwd}\`` : '') +
            `?\n\n` +
            `_Output will be returned to the agent. Timeout: ` +
            `${options.input.timeoutSeconds ?? 30}s._`
        ),
      },
    };
  }
}

export const runTerminalTool: ToolDefinition<RunTerminalInput> = {
  descriptor: {
    llmName: 'run_terminal_command',
    vsCodeName: 'pilotcode_run_terminal_command',
    description:
      'Run a shell command in the workspace and return its stdout / stderr / ' +
      'exit code. The user is always asked to confirm first. Optional `cwd` ' +
      '(workspace-relative). Optional `timeoutSeconds` (default 30, max 120).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute (e.g. "npm test").',
        },
        cwd: {
          type: 'string',
          description: 'Workspace-relative working directory (default ".").',
        },
        timeoutSeconds: {
          type: 'number',
          description: 'Timeout in seconds (1-120, default 30).',
        },
      },
      required: ['command'],
    },
    destructive: true,
  },
  factory: () => new RunTerminalTool(),
};
