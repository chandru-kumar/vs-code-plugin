import * as vscode from 'vscode';
import type { BoschCopilotSettings } from '../config/settings';

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
      'bosch-copilot.status',
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.name = 'Bosch-CoPilot';
    this.item.command = 'bosch-copilot.toggleInlineCompletions';
    this.render();
    this.item.show();
  }

  applySettings(s: BoschCopilotSettings): void {
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
      this.item.text = '$(circle-slash) Bosch-CoPilot';
      this.item.tooltip =
        'Bosch-CoPilot inline completions are OFF — click to enable';
      return;
    }
    if (this.busyCount > 0) {
      this.item.text = '$(loading~spin) Bosch-CoPilot';
      this.item.tooltip = 'Bosch-CoPilot is generating a completion…';
    } else {
      this.item.text = '$(rocket) Bosch-CoPilot';
      this.item.tooltip =
        'Bosch-CoPilot inline completions are ON — click to disable';
    }
  }
}
