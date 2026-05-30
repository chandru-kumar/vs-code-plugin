import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import {
  readSettings,
  onSettingsChanged,
  CONFIG_SECTION,
} from './config/settings';
import { registerChatParticipant } from './chat/participant';
import { StatusBar } from './ui/statusBar';
import { BoschCopilotInlineProvider } from './completions/inlineProvider';
import { runDiagnose } from './commands/diagnose';
import { prewarmCompletionModel } from './model/warmup';
import { registerAllTools } from './tools';

let logger: Logger | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  logger = new Logger('Bosch-CoPilot');
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  const settings = readSettings();
  logger.setLevel(settings.logLevel);
  logger.info('Bosch-CoPilot activating', {
    version: context.extension.packageJSON.version,
    endpoint: settings.endpoint,
    chatModel: settings.chatModel,
    completionModel: settings.completionModel,
  });

  // --- Phase 4: register tools (must happen before chat participant
  //              so the agent loop has the descriptors) ------------------
  const toolDescriptors = registerAllTools(context, logger);

  // --- Phase 1 + 3 + 4: chat participant ---------------------------------
  registerChatParticipant(context, logger, toolDescriptors);

  // --- Phase 2: inline completions ---------------------------------------
  const statusBar = new StatusBar();
  const inlineProvider = new BoschCopilotInlineProvider(
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
    vscode.commands.registerCommand('bosch-copilot.openSettings', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:chandru-kumar.bosch-copilot'
      );
    }),
    vscode.commands.registerCommand('bosch-copilot.showOutput', () => {
      logger?.show();
    }),
    vscode.commands.registerCommand(
      'bosch-copilot.testConnection',
      async () => {
        await testConnectionCommand(logger!);
      }
    ),
    vscode.commands.registerCommand('bosch-copilot.diagnose', async () => {
      await runDiagnose(logger!);
    }),
    vscode.commands.registerCommand(
      'bosch-copilot.toggleInlineCompletions',
      async () => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const current = cfg.get<boolean>('enableInlineCompletions', true);
        await cfg.update(
          'enableInlineCompletions',
          !current,
          vscode.ConfigurationTarget.Global
        );
        void vscode.window.showInformationMessage(
          `Bosch-CoPilot inline completions ${!current ? 'enabled' : 'disabled'}.`
        );
      }
    )
  );

  logger.info('Bosch-CoPilot activated.');

  // Kick off a background prewarm a moment after activation completes
  // so the user's first inline completion is fast. Fire-and-forget;
  // never blocks activation.
  setTimeout(() => {
    void prewarmCompletionModel(logger!);
  }, 2_000);
}

export function deactivate(): void {
  logger?.info('Bosch-CoPilot deactivating');
}

async function testConnectionCommand(log: Logger): Promise<void> {
  const s = readSettings();
  // For local OpenAI-compatible endpoints, hit /models (standard listing).
  // For Azure OpenAI, hit /openai/models?api-version=...
  // For Vertex AI types, there's no models endpoint — test connectivity to base.
  const base = s.endpoint.replace(/\/+$/, '');
  let url: string;
  switch (s.apiType) {
    case 'azure-openai':
      url = s.apiVersion
        ? `${base}/openai/models?api-version=${encodeURIComponent(s.apiVersion)}`
        : `${base}/openai/models`;
      break;
    case 'anthropic':
    case 'vertex-openai':
      // Vertex AI doesn't expose a models listing — just ping base URL.
      url = base;
      break;
    case 'openai':
    default:
      url = `${base}/models`;
      break;
  }
  log.info(`Testing endpoint: GET ${url}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Bosch-CoPilot: pinging ${s.endpoint} ...`,
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
          `Bosch-CoPilot: endpoint reachable. Models: ${truncated}${more}`
        );
      } catch (err) {
        log.error('Endpoint test failed', err);
        const msg = err instanceof Error ? err.message : String(err);
        const choice = await vscode.window.showErrorMessage(
          `Bosch-CoPilot: could not reach ${s.endpoint} (${msg}).`,
          'Open Settings',
          'Show Logs'
        );
        if (choice === 'Open Settings') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:chandru-kumar.bosch-copilot'
          );
        } else if (choice === 'Show Logs') {
          log.show();
        }
      }
    }
  );
}
