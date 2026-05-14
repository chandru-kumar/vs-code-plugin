import * as vscode from 'vscode';
import type { PilotCodeSettings } from '../config/settings';

/**
 * Status-bar indicator for inline completions. Click toggles them on/off.
 * `setBusy` is reference-counted so overlapping in-flight requests don't
 * prematurely flip the indicator back to idle.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private busyCount = 0;
  private enabled = true;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      'pilotcode.status',
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.name = 'PilotCode';
    this.item.command = 'pilotcode.toggleInlineCompletions';
    this.render();
    this.item.show();
  }

  applySettings(s: PilotCodeSettings): void {
    this.enabled = s.enableInlineCompletions;
    this.render();
  }

  setBusy(busy: boolean): void {
    this.busyCount = Math.max(0, this.busyCount + (busy ? 1 : -1));
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    if (!this.enabled) {
      this.item.text = '$(circle-slash) PilotCode';
      this.item.tooltip =
        'PilotCode inline completions are OFF — click to enable';
      return;
    }
    if (this.busyCount > 0) {
      this.item.text = '$(loading~spin) PilotCode';
      this.item.tooltip = 'PilotCode is generating a completion…';
    } else {
      this.item.text = '$(rocket) PilotCode';
      this.item.tooltip =
        'PilotCode inline completions are ON — click to disable';
    }
  }
}
