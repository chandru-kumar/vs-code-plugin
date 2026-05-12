import * as vscode from 'vscode';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export class Logger {
  private readonly channel: vscode.LogOutputChannel;
  private level: LogLevel = 'info';

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  show(preserveFocus = true): void {
    this.channel.show(preserveFocus);
  }

  dispose(): void {
    this.channel.dispose();
  }

  trace(message: string, ...args: unknown[]): void {
    if (this.shouldLog('trace')) {
      this.channel.trace(this.fmt(message, args));
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      this.channel.debug(this.fmt(message, args));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      this.channel.info(this.fmt(message, args));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      this.channel.warn(this.fmt(message, args));
    }
  }

  error(message: string, err?: unknown): void {
    if (!this.shouldLog('error')) {
      return;
    }
    if (err instanceof Error) {
      this.channel.error(`${message}: ${err.message}\n${err.stack ?? ''}`);
    } else if (err !== undefined) {
      this.channel.error(`${message}: ${JSON.stringify(err)}`);
    } else {
      this.channel.error(message);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  private fmt(message: string, args: unknown[]): string {
    if (args.length === 0) {
      return message;
    }
    const formatted = args
      .map((a) =>
        typeof a === 'string' ? a : safeStringify(a)
      )
      .join(' ');
    return `${message} ${formatted}`;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
