# PilotCode

> Local-first, offline-capable Copilot clone for VS Code — powered by
> Qwen 2.5/3-Coder via Ollama, LM Studio, vLLM, or any OpenAI-compatible
> endpoint. Inline completions, full chat sidebar, agentic tool-calling,
> and native Model Context Protocol (MCP) support.

**Status:** Phase 1 of 8 — scaffolding + `@pilotcode` chat participant + settings.

---

## Why PilotCode?

| Feature                       | PilotCode                              | GitHub Copilot |
| ----------------------------- | -------------------------------------- | -------------- |
| Works fully offline           | ✅                                     | ❌             |
| Bring-your-own model          | ✅ (any OpenAI-compatible endpoint)    | ❌             |
| Zero telemetry by default     | ✅                                     | ❌             |
| Inline ghost-text completions | ✅ (Phase 2)                           | ✅             |
| Chat participant + sidebar    | ✅ `@pilotcode`                        | ✅             |
| Agentic tool-calling loop     | ✅ (Phase 4)                           | ✅             |
| MCP client + MCP Apps         | ✅ (Phase 5)                           | ✅             |
| Bundled dev-tools MCP server  | ✅ (Phase 6)                           | ❌             |
| Custom agents / slash cmds    | ✅ (Phase 7) `/fix /refactor /test ..` | ✅             |
| Open source (MIT)             | ✅                                     | ❌             |

---

## Phased roadmap

- [x] **Phase 1** — Scaffolding, chat participant, settings, output channel, F5 debug ← **you are here**
- [ ] **Phase 2** — Inline ghost-text completions (debounced, context-aware, multi-suggestion)
- [ ] **Phase 3** — Qwen / OpenAI-compatible streaming chat client
- [ ] **Phase 4** — ReAct agentic loop + tool-calling + self-correction
- [ ] **Phase 5** — MCP consumption (discover, connect, MCP Apps UI in chat)
- [ ] **Phase 6** — Ship our own MCP server with dev tools (`analyze_monorepo_dependencies`, `run_security_scan`, `generate_pr_description`, `batch_file_edit_with_diff`, …)
- [ ] **Phase 7** — Custom agents, skills, hooks, slash commands, polish
- [ ] **Phase 8** — Packaging (`.vsix`), marketplace publishing, perf tuning

---

## Requirements

- **VS Code** 1.95.0 or newer (latest stable or Insiders recommended).
- **Node.js** 20.x or newer (only required to build from source).
- A local OpenAI-compatible LLM endpoint. Recommended:
  - [Ollama](https://ollama.com) — `ollama pull qwen2.5-coder:7b`
  - [LM Studio](https://lmstudio.ai)
  - or any remote OpenAI-compatible API (set `pilotcode.apiKey`).

---

## ⚡ Quick start (Windows — pull-and-test on your dev machine)

> The repo is developed on macOS but is fully cross-platform. The steps
> below assume **Windows 10/11 with VS Code installed**.

### 1. Install prerequisites (Windows)

Open PowerShell **as Administrator** and run:

```powershell
# Git
winget install --id Git.Git -e

# Node.js LTS (>= 20)
winget install --id OpenJS.NodeJS.LTS -e

# (Optional but recommended) Ollama so you have a local model
winget install --id Ollama.Ollama -e
```

Restart PowerShell so the new `git`, `node`, `npm`, and `ollama`
commands are on `PATH`.

Verify:

```powershell
git --version
node --version   # should be >= 20
npm --version
```

### 2. Pull a model (optional but recommended for later phases)

```powershell
ollama pull qwen2.5-coder:7b
# For inline completions later (Phase 2), a smaller base model is best:
ollama pull qwen2.5-coder:1.5b-base
```

Sanity-check the endpoint:

```powershell
curl http://localhost:11434/v1/models
```

### 3. Clone and install

Pick a folder, then:

```powershell
cd $HOME\source\repos       # or anywhere you like
git clone https://github.com/chandru-kumar/vs-code-plugin.git
cd vs-code-plugin
npm install
```

### 4. Open in VS Code

```powershell
code .
```

When VS Code asks **"Do you trust the authors of the files in this folder?"** → click **Yes, I trust the authors**. (Required so the F5 debug + build tasks can run.)

You'll also get a prompt to install recommended extensions
(ESLint, Prettier) — accept it.

### 5. Run the extension (F5 debug)

1. Press **`F5`** (or open *Run and Debug* sidebar → **Run Extension**).
2. A second VS Code window labeled **`[Extension Development Host]`** will open. This is where PilotCode is now loaded.
3. The first time you press F5, the `npm: watch` build task starts in the background and produces `dist/extension.js`. Wait ~5 s the first time.

### 6. Use `@pilotcode` in chat

In the **Extension Development Host** window:

1. Open the **Chat** view (Ctrl+Alt+I, or click the Chat icon in the activity bar).
2. Type `@pilotcode hello` and press Enter.
3. You should see a Phase 1 response showing your current configuration, plus two action buttons (Open Settings, Test Endpoint Connection).

### 7. Test the endpoint connection

In the **Extension Development Host** window:

1. **`Ctrl+Shift+P`** → *PilotCode: Test Model Endpoint Connection*.
2. With Ollama running, you should see *"endpoint reachable. Models: …"*.
3. If it fails, click **Show Logs** for details.

### 8. Configure

In the **Extension Development Host** window: **`Ctrl+,`** → search for `pilotcode`. You can change endpoint, models, temperature, etc. All settings live-update; no reload needed.

---

## Manual test checklist for Phase 1 (Windows)

| # | Action                                                                               | Expected                                                                    |
| - | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1 | `npm install` completes                                                              | No errors                                                                   |
| 2 | `npm run compile` succeeds                                                           | `dist/extension.js` created, no TS errors                                   |
| 3 | `npm run check-types` succeeds                                                       | No TS errors                                                                |
| 4 | Press **F5**                                                                         | Extension Development Host window opens                                     |
| 5 | In the host window: `@pilotcode hello`                                               | Markdown response appears with current endpoint / model                     |
| 6 | Click **Open PilotCode Settings** button in chat                                     | Settings UI opens filtered to `pilotcode.*`                                 |
| 7 | Change `pilotcode.chatModel` to anything                                             | The next `@pilotcode` reply reflects the new model name (no reload needed)  |
| 8 | `Ctrl+Shift+P` → *PilotCode: Test Model Endpoint Connection* (Ollama running)        | Toast: "endpoint reachable. Models: qwen2.5-coder:…"                        |
| 9 | `Ctrl+Shift+P` → *PilotCode: Show Output Channel*                                    | Output panel shows the `PilotCode` log channel with INFO entries            |
| 10| Stop Ollama / change endpoint to `http://localhost:9999` → run *Test Connection*     | Error toast appears with **Open Settings** / **Show Logs** actions          |

If all 10 pass, Phase 1 is verified.

---

## Project layout

```
vs-code-plugin/
├── .github/workflows/ci.yml      # Build matrix (Win + Linux + macOS)
├── .vscode/
│   ├── launch.json               # F5 debug
│   ├── tasks.json                # npm: watch as default build task
│   ├── extensions.json           # Recommended dev extensions
│   └── settings.json             # Project formatting
├── src/
│   ├── extension.ts              # activate() / deactivate()
│   ├── chat/participant.ts       # @pilotcode chat participant
│   ├── config/settings.ts        # typed settings reader + change listener
│   └── utils/logger.ts           # Level-aware LogOutputChannel wrapper
├── esbuild.js                    # Bundler
├── package.json                  # Manifest + contributes
├── tsconfig.json                 # Strict TS config
└── README.md                     # This file
```

---

## Troubleshooting

**"Cannot find module 'vscode'"** — run `npm install` first.

**`@pilotcode` does not appear in chat** — make sure you're in the
*Extension Development Host* window (not the dev window). The participant
is only registered in the host.

**F5 doesn't start a build** — open the *Terminal → Run Task…* menu and
pick `npm: watch` manually, then F5 again.

**`fetch` is undefined** — you're on Node < 18 in your terminal. The
extension uses VS Code's bundled Node 20 runtime, but `npm run compile`
needs Node 20+ on `PATH`.

**Windows Defender / SmartScreen flags the cloned folder** — that's
expected on a fresh clone; allow it. We sign nothing in the dev workflow.

---

## Contributing

Issues and PRs welcome at
<https://github.com/chandru-kumar/vs-code-plugin>.

License: [MIT](LICENSE).
