import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import {
  readSettings,
  onSettingsChanged,
  CONFIG_SECTION,
} from './config/settings';
import { registerChatParticipant } from './chat/participant';
import { StatusBar } from './ui/statusBar';
import { PilotCodeInlineProvider } from './completions/inlineProvider';
import { runDiagnose } from './commands/diagnose';
import { prewarmCompletionModel } from './model/warmup';

let logger: Logger | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  logger = new Logger('PilotCode');
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  const settings = readSettings();
  logger.setLevel(settings.logLevel);
  logger.info('PilotCode activating', {
    version: context.extension.packageJSON.version,
    endpoint: settings.endpoint,
    chatModel: settings.chatModel,
    completionModel: settings.completionModel,
  });

  // --- Phase 1: chat participant -----------------------------------------
  registerChatParticipant(context, logger);

  // --- Phase 2: inline completions ---------------------------------------
  const statusBar = new StatusBar();
  const inlineProvider = new PilotCodeInlineProvider(
    readSettings,
    logger,
    statusBar
  );
  statusBar.applySettings(settings);

  context.subscriptions.push(
    statusBar,
    { dispose: () => inlineProvider.dispose() },
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      inlineProvider
    )
  );

  // --- React to settings changes -----------------------------------------
  context.subscriptions.push(
    onSettingsChanged((next) => {
      logger?.setLevel(next.logLevel);
      inlineProvider.onSettingsChanged(next);
      statusBar.applySettings(next);
      logger?.info('Settings changed', {
        endpoint: next.endpoint,
        chatModel: next.chatModel,
        completionModel: next.completionModel,
        inlineCompletions: next.enableInlineCompletions,
      });
    })
  );

  // --- Commands ----------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('pilotcode.openSettings', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:chandru-kumar.pilotcode'
      );
    }),
    vscode.commands.registerCommand('pilotcode.showOutput', () => {
      logger?.show();
    }),
    vscode.commands.registerCommand('pilotcode.testConnection', async () => {
      await testConnectionCommand(logger!);
    }),
    vscode.commands.registerCommand('pilotcode.diagnose', async () => {
      await runDiagnose(logger!);
    }),
    vscode.commands.registerCommand(
      'pilotcode.toggleInlineCompletions',
      async () => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const current = cfg.get<boolean>('enableInlineCompletions', true);
        await cfg.update(
          'enableInlineCompletions',
          !current,
          vscode.ConfigurationTarget.Global
        );
        void vscode.window.showInformationMessage(
          `PilotCode inline completions ${!current ? 'enabled' : 'disabled'}.`
        );
      }
    )
  );

  logger.info('PilotCode activated.');

  // Kick off a background prewarm a moment after activation completes
  // so the user's first inline completion is fast. Fire-and-forget;
  // never blocks activation.
  setTimeout(() => {
    void prewarmCompletionModel(logger!);
  }, 2_000);
}

export function deactivate(): void {
  logger?.info('PilotCode deactivating');
}

async function testConnectionCommand(log: Logger): Promise<void> {
  const s = readSettings();
  const url = `${s.endpoint}/models`;
  log.info(`Testing endpoint: GET ${url}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `PilotCode: pinging ${s.endpoint} ...`,
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
        };
        if (s.apiKey) {
          headers.Authorization = `Bearer ${s.apiKey}`;
        }
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const body = (await res.json()) as {
          data?: Array<{ id: string }>;
        };
        const ids = (body.data ?? []).map((m) => m.id);
        log.info(`Endpoint OK. ${ids.length} model(s) available.`, ids);

        const truncated = ids.slice(0, 8).join(', ') || '(none reported)';
        const more = ids.length > 8 ? `, +${ids.length - 8} more` : '';
        void vscode.window.showInformationMessage(
          `PilotCode: endpoint reachable. Models: ${truncated}${more}`
        );
      } catch (err) {
        log.error('Endpoint test failed', err);
        const msg = err instanceof Error ? err.message : String(err);
        const choice = await vscode.window.showErrorMessage(
          `PilotCode: could not reach ${s.endpoint} (${msg}).`,
          'Open Settings',
          'Show Logs'
        );
        if (choice === 'Open Settings') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:chandru-kumar.pilotcode'
          );
        } else if (choice === 'Show Logs') {
          log.show();
        }
      }
    }
  );
}
