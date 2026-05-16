# PilotCode

> Local-first, offline-capable Copilot clone for VS Code — powered by
> Qwen 2.5/3-Coder via Ollama, LM Studio, vLLM, or any OpenAI-compatible
> endpoint. Inline completions, full chat sidebar, agentic tool-calling,
> and native Model Context Protocol (MCP) support.

**Status:** Phase 2 of 8 — inline ghost-text completions (debounced, context-aware, FIM + instruct, multi-suggestion).

---

## Why PilotCode?

| Feature                       | PilotCode                              | GitHub Copilot |
| ----------------------------- | -------------------------------------- | -------------- |
| Works fully offline           | ✅                                     | ❌             |
| Bring-your-own model          | ✅ (any OpenAI-compatible endpoint)    | ❌             |
| Zero telemetry by default     | ✅                                     | ❌             |
| Inline ghost-text completions | ✅ **(done — Phase 2)**                | ✅             |
| Chat participant + sidebar    | ✅ `@pilotcode`                        | ✅             |
| Agentic tool-calling loop     | ✅ (Phase 4)                           | ✅             |
| MCP client + MCP Apps         | ✅ (Phase 5)                           | ✅             |
| Bundled dev-tools MCP server  | ✅ (Phase 6)                           | ❌             |
| Custom agents / slash cmds    | ✅ (Phase 7) `/fix /refactor /test ..` | ✅             |
| Open source (MIT)             | ✅                                     | ❌             |

---

## Phased roadmap

- [x] **Phase 1** — Scaffolding, chat participant, settings, output channel, F5 debug
- [x] **Phase 2** — Inline ghost-text completions (debounced, context-aware, multi-suggestion) ← **you are here**
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

## ✨ Phase 2 — Inline completions (ghost text)

Phase 2 adds Copilot-style ghost text: as you type, PilotCode asks your
local model to complete the code at the cursor and shows the suggestion
inline. Press **Tab** to accept, **Esc** to dismiss, **Alt+]** / **Alt+[**
to cycle alternatives.

### How it works

- **Two prompting strategies, auto-selected** by `pilotcode.completionStrategy`:
  - `fim` — fill-in-the-middle via `/completions`, for `*-base` / `*-coder`
    models (e.g. `qwen2.5-coder:1.5b-base`). Highest quality for code.
  - `instruct` — a completion-style prompt via `/chat/completions`, works
    with any chat model (`qwen3.5:latest`, `qwen3.6:latest`, `llama3.1`, …).
  - `auto` (default) picks `fim` when the model name contains `base`/`coder`,
    otherwise `instruct`.
- **Debounced** (`pilotcode.completionDebounceMs`, default 250 ms) so the
  local model isn't hammered on every keystroke; superseded requests are
  cancelled and their network calls aborted.
- **Context-aware** — sends N lines before/after the cursor
  (`completionPrefixLines` / `completionSuffixLines`), hard-capped by
  `completionMaxContextChars`.
- **Multi-suggestion** — set `pilotcode.completionCount` to 2–3 for
  alternatives (parallel requests; slower on local models).
- **Status bar item** — bottom-right `$(rocket) PilotCode` (idle),
  `$(loading~spin) PilotCode` (generating), `$(circle-slash) PilotCode`
  (disabled). Click it to toggle completions.

> **Which model?** Your machine has `qwen3.5:latest` / `qwen3.6:latest`
> (chat models) → `auto` resolves to **instruct** mode and works out of the
> box. For noticeably sharper completions, pull a base coder model and
> point `pilotcode.completionModel` at it:
> ```powershell
> ollama pull qwen2.5-coder:1.5b-base
> ```
> then set `pilotcode.completionModel` = `qwen2.5-coder:1.5b-base`
> (`auto` will switch to FIM mode automatically).

### Manual test checklist for Phase 2 (Windows)

Do these in the **Extension Development Host** window, with Ollama running.

| #  | Action                                                                                          | Expected                                                                          |
| -- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1  | `git pull` the `feature/inline-completions` branch, `npm install`, `npm run compile`            | Clean build, `dist/extension.js` updated                                          |
| 2  | Press **F5**                                                                                    | Extension Development Host opens; bottom-right shows **`$(rocket) PilotCode`**     |
| 3  | First set `pilotcode.completionModel` to `qwen3.6:latest` (a model you actually have)           | Setting saved (no reload needed)                                                  |
| 4  | Create a new file `test.js`, type `function add(a, b) {` and press **Enter**                    | After ~0.3–2 s, grey ghost text appears suggesting the body                       |
| 5  | Press **Tab**                                                                                   | Ghost text is inserted as real code                                               |
| 6  | Type a comment `// reverse a string` then Enter                                                 | Ghost text suggests a reverse-string implementation                               |
| 7  | While ghost text is showing, keep typing                                                        | Old suggestion is dropped, a new one is requested (debounced) — no lag/freeze      |
| 8  | Watch the status bar while a completion generates                                               | It briefly shows **`$(loading~spin) PilotCode`**, then back to `$(rocket)`         |
| 9  | `Ctrl+Shift+P` → *PilotCode: Toggle Inline Completions* (or click the status bar item)          | Toast confirms "disabled"; status bar shows **`$(circle-slash) PilotCode`**; typing produces no ghost text |
| 10 | Toggle it back on; set `pilotcode.completionCount` to `3`, type a function signature, press **Alt+]** | Cycles through up to 3 alternative completions                              |
| 11 | `Ctrl+Shift+P` → *PilotCode: Show Output Channel*, set `pilotcode.logLevel` to `debug`, type to trigger a completion | Log shows lines like `inline: 1 suggestion(s) in NNNms (instruct)`     |
| 12 | Set `pilotcode.completionModel` to a non-existent model, type to trigger                        | No ghost text, no crash; Output channel logs an HTTP 404 error                    |

If 1–11 pass, Phase 2 is verified. (Step 12 just confirms graceful failure.)

**Please paste the Output channel logs** (with `logLevel` = `debug`) after
running through this — especially the `inline: … (instruct)` lines and any
errors — so I can verify timing/strategy on your Windows box.

### Phase 2 troubleshooting

> 🩺 **First step for any issue: `Ctrl+Shift+P` → *PilotCode: Diagnose*.**
> It checks the endpoint, validates your model names (and suggests fixes
> for typos like `qwen3.6:latesttt` → `qwen3.6:latest`), and fires a real
> test completion round-trip — all in one click. Results open in a
> markdown editor you can read, copy, or share.

| Symptom | Fix |
| --- | --- |
| No ghost text at all | Run **PilotCode: Diagnose** — it catches all the common causes (wrong endpoint, missing/mis-typed model, model still cold-loading, competing extension, etc.). |
| Lots of HTTP 404s in Output | Almost always a typo in `pilotcode.completionModel`. Diagnose will print *"did you mean X?"* with the closest available model. |
| First completion after switching models takes 30+ s | Ollama is loading the model into RAM. Subsequent calls are fast. Pause typing so the first request isn't cancelled. |
| Ghost text is very slow | Lower `completionMaxTokens` (e.g. 128), use a smaller model, or raise `completionDebounceMs`. Local model speed is the bottleneck. |
| Completions repeat the code after the cursor | You're on a chat model in `instruct` mode — try a `*-coder` model with `auto`/`fim`. The suffix-overlap trimmer handles most cases but FIM is cleaner. |
| Completions are chatty / include prose | Same as above — chat models sometimes ignore the "code only" instruction. A base/coder model in FIM mode fixes this. |
| Completions wrapped in ```` ``` ```` fences | The instruct-output cleaner strips a single fence; if you still see them, the model added prose around it — switch to a coder model. |
| GitHub Copilot is installed and showing its own ghost text | In the Extension Development Host: `Ctrl+,` → search `github.copilot.enable` → set to `false`. PilotCode then wins the inline-completion slot. |

---

## Project layout

```
vs-code-plugin/
├── .github/workflows/ci.yml         # Build matrix (Win + Linux + macOS)
├── .vscode/
│   ├── launch.json                  # F5 debug
│   ├── tasks.json                   # npm: watch as default build task
│   ├── extensions.json              # Recommended dev extensions
│   └── settings.json                # Project formatting
├── src/
│   ├── extension.ts                 # activate() / deactivate(), commands
│   ├── chat/
│   │   └── participant.ts           # @pilotcode chat participant
│   ├── completions/                 # ── Phase 2 ──
│   │   ├── inlineProvider.ts         #   InlineCompletionItemProvider
│   │   ├── contextGatherer.ts        #   prefix/suffix windowing
│   │   ├── promptStrategies.ts       #   FIM + instruct prompts, post-proc
│   │   └── debouncer.ts              #   debounce + cancellation
│   ├── model/
│   │   └── completionClient.ts       #   HTTP client (FIM + instruct)
│   ├── config/settings.ts           # typed settings reader + change listener
│   ├── ui/statusBar.ts              # status-bar indicator (Phase 2)
│   └── utils/logger.ts              # Level-aware LogOutputChannel wrapper
├── esbuild.js                       # Bundler
├── package.json                     # Manifest + contributes
├── tsconfig.json                    # Strict TS config
└── README.md                        # This file
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
