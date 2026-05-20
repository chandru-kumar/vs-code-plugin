# PilotCode

> Local-first, offline-capable Copilot clone for VS Code — powered by
> Qwen 2.5/3-Coder via Ollama, LM Studio, vLLM, or any OpenAI-compatible
> endpoint. Inline completions, full chat sidebar, agentic tool-calling,
> and native Model Context Protocol (MCP) support.

**Status:** Phase 4 of 8 — agentic mode with ReAct loop + 6 local tools (read/list/grep/write/diff/terminal), plus everything from Phases 1–3.

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
- [x] **Phase 2** — Inline ghost-text completions (debounced, context-aware, multi-suggestion)
- [x] **Phase 3** — Qwen / OpenAI-compatible streaming chat client + slash commands
- [x] **Phase 4** — ReAct agentic loop + 6 local tools (in-process) ← **you are here**
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

## 💬 Phase 3 — Streaming chat + slash commands

`@pilotcode` is now a real chat agent — it streams Markdown into the Chat
view as your local model generates tokens, with full conversation history,
active-editor context, and four built-in slash commands.

### How it works

- **Streaming** over `POST /chat/completions` (OpenAI-compatible SSE).
  Tokens appear in the Chat view as they arrive; no waiting for the full
  response. First-token latency and total latency are logged at INFO:
  ```
  chat: streamed 1247 chars in 4820ms (first token 612ms, model=qwen2.5-coder:7b, /explain)
  ```
- **Context auto-injected** into every turn:
  - The system prompt names your workspace.
  - The active editor's filename + language is included; if you have a
    selection, the selected code is attached in a fenced block.
  - `#file:path/to/foo.ts` references are read and inlined (up to 5 files,
    4 KB each).
  - The last 10 `@pilotcode` turns of conversation history are replayed.
- **Slash commands** (shown as suggestions when you type `/` in the chat
  input):

  | Command      | What it does                                     |
  | ------------ | ------------------------------------------------ |
  | `/explain`   | Walks through the selected/active code           |
  | `/fix`       | Identifies the bug, returns corrected code       |
  | `/test`      | Generates idiomatic unit tests                   |
  | `/refactor`  | Improves clarity, preserves behaviour            |

  Each command appends a task-specific addendum to the system prompt and
  rewrites the user message using a template — your raw prompt is kept
  as additional context.
- **Follow-up suggestions** appear under every reply: *Explain further*,
  *Write tests* (→ `/test`), *Refactor* (→ `/refactor`). One click sends.
- **Typed error handling** — model-not-found, network errors, etc. render
  a clear card in the Chat view with **Run Diagnose** / **Open Settings**
  buttons, not a stack trace.

### Manual test checklist for Phase 3 (Windows)

Do these in the **Extension Development Host** window, with Ollama running
and `pilotcode.chatModel` pointing at a model you actually have (e.g.
`qwen2.5-coder:7b` if pulled, or whatever `ollama list` shows).

| #  | Action                                                                                                          | Expected                                                                                          |
| -- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1  | `git pull`, `npm install`, `npm run compile`, press **F5**                                                      | Clean build; Extension Development Host opens                                                     |
| 2  | Within a few seconds of activation, watch Output: `PilotCode: Show Output Channel`                              | `prewarm: warming completion model '…' on http://…` followed by `prewarm: '…' ready in NNNms`     |
| 3  | Open Chat (`Ctrl+Alt+I`), type just `@pilotcode` and press Enter                                                | Welcome card with the slash-command list, no model call made                                      |
| 4  | Type `@pilotcode Write a Python function that reverses a string`                                                | Markdown streams in token by token; a fenced Python block appears                                 |
| 5  | After it finishes, check Output                                                                                 | `chat: streamed N chars in NNNms (first token NNms, model=…)`                                     |
| 6  | Select some code in an editor, then in Chat type `@pilotcode /explain`                                          | Reply starts with a walkthrough of the selected code (and references it)                          |
| 7  | Type `@pilotcode /test` with a function selected                                                                | A unit-test file is generated in the appropriate framework for that language                      |
| 8  | Type `@pilotcode /refactor` with code selected                                                                  | Refactored code returned, followed by 2–3 bullets describing the changes                          |
| 9  | After step 6/7/8 finishes, you should see follow-up chips below the reply: 💡 Explain further / 🧪 Write tests / 🧹 Refactor | Click one — it sends a follow-up automatically                                          |
| 10 | While a streaming reply is in progress, press the stop button (square icon in Chat input) or `Esc`              | Streaming stops immediately; no orphaned model calls                                              |
| 11 | Set `pilotcode.chatModel` to `qwen3.6:latesttt` (typo) and ask a question                                       | Reply shows ❌ *"Model 'qwen3.6:latesttt' not found"* with Run Diagnose / Open Settings buttons   |
| 12 | Fix the typo, type a normal completion-triggering line in a file                                                | Output should show the 🎉 **first-success marker** line on the very first ghost text of the session |
| 13 | `ollama pull qwen2.5-coder:1.5b-base`, set `pilotcode.completionModel` to it, type some Python                  | Completions feel sharper; FIM stop tokens prevent run-on into the next `def`/`class`              |

If 1–10 pass cleanly, **Phase 3 is verified**. Steps 11–13 confirm the
Phase 2 polish landed too.

### Phase 3 troubleshooting

| Symptom | Fix |
| --- | --- |
| Chat reply is empty or "request failed" | Run **PilotCode: Diagnose**. Most likely your `chatModel` setting points at a model you haven't pulled. |
| Reply streams very slowly | Use a smaller chat model (`qwen3.6:latest` instead of a 14B+). Or accept that local 7B+ models stream at ~30–50 tok/s on consumer hardware. |
| `/explain` / `/fix` / etc. don't appear when typing `/` | The slash commands are declared in `package.json` — reload the Extension Development Host (`Ctrl+R` inside it) after pulling a new version. |
| Cancel button doesn't stop generation | It should — we abort the HTTP request *and* cancel the body reader. If it doesn't, please file an issue with the Output log. |
| Prewarm log never appears | Either `pilotcode.prewarmOnActivation` is `false`, or `enableInlineCompletions` is `false`, or your endpoint is unreachable (Diagnose will tell you). |

---

## 🤖 Phase 4 — Agentic mode + local tools

`@pilotcode` is now an **agent**: it can *reason → call a tool → see the
result → reason again → ...* until it produces a final answer. Six tools
ship in-process; remote MCP tools come in Phase 5.

### How it works (ReAct loop)

```
You: "Read src/app.ts and tell me what it does"
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ PilotCode agent loop (max 5 iterations by default)           │
│                                                              │
│ 1. Send messages + 6 tool schemas to Qwen                    │
│ 2. Qwen replies: tool_calls=[{ read_file, {"path":"..."} }]  │
│ 3. Render "🔧 read_file(...)" in chat                        │
│ 4. Invoke via vscode.lm.invokeTool (handles confirmation)    │
│ 5. Append tool result as { role: "tool", ... }               │
│ 6. Send again — Qwen now has the file content                │
│ 7. Qwen replies with the final answer (no tool_calls)        │
│ 8. Render the answer                                          │
└──────────────────────────────────────────────────────────────┘
```

### The six built-in tools

| Tool name            | Destructive? | What it does                                                                  |
| -------------------- | ------------ | ----------------------------------------------------------------------------- |
| `read_file`          | no           | Read a workspace file. Large files are truncated for the model.               |
| `list_directory`     | no           | List immediate children of a directory (with F/D/L markers).                  |
| `grep_workspace`     | no           | Literal-substring search across the workspace. Skips node_modules/dist/etc.   |
| `write_file`         | **yes**      | Write a file (overwrite or create-only). **Confirmation card with preview.**  |
| `apply_diff`         | **yes**      | Replace a unique substring in a file. **Confirmation card with diff preview.**|
| `run_terminal_command` | **yes**    | Run a shell command. Returns stdout/stderr/exit code. **Confirmation card.**  |

**Path safety:** all file tools reject absolute paths and `..` traversal —
nothing outside the workspace folder can be touched.

**Tool referencing:** because each tool has `canBeReferencedInPrompt: true`,
you can also pin one with `#read_file` in chat to nudge the agent toward it.

### Manual test checklist for Phase 4 (Windows)

Do these in the **Extension Development Host** window with Ollama running
and `pilotcode.chatModel` set to a model that supports tool calling
(`qwen2.5-coder:7b` is the sweet spot — smaller chat models like
`qwen3.5:latest` will work but call tools less reliably).

> ⚠️ **Important:** open a folder as the workspace before testing (e.g.
> `File → Open Folder…` → pick the cloned `vs-code-plugin` itself). Tools
> like `read_file` / `grep_workspace` need a workspace.

| #  | Action                                                                                                  | Expected                                                                                          |
| -- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1  | `git fetch && git checkout feature/agent-loop && git pull && npm install && npm run compile`            | Clean build                                                                                       |
| 2  | F5 → in host: Output channel                                                                            | New line: `Registered 6 tool(s): read_file, list_directory, grep_workspace, write_file, …`        |
| 3  | Chat: `@pilotcode list the files in src/`                                                               | "🔧 `list_directory({"path":"src"})`" → "✅ … → N chars" → final answer with the file list        |
| 4  | Chat: `@pilotcode read src/extension.ts and tell me what activate() does`                               | Sequence shows `read_file` call, then a summary of `activate()`                                   |
| 5  | Chat: `@pilotcode find all uses of "TODO" in the project`                                               | `grep_workspace` call, then a summary of matches                                                  |
| 6  | Chat: `@pilotcode create a file scratch/hello.py that prints "hello from pilotcode"`                    | **Confirmation card appears** showing the file path + content preview + Continue / Cancel buttons |
| 7  | Click **Continue** on step 6                                                                            | "✅ `write_file` → N chars"; file actually appears on disk                                        |
| 8  | Click **Cancel** on a follow-up write (e.g. `@pilotcode write a README to scratch/README.md`)           | "❌ `write_file` failed: …user declined…" — no file written                                       |
| 9  | Chat: `@pilotcode in src/extension.ts replace the deactivate() body with: logger?.info("bye")`         | `read_file` first, then `apply_diff` confirmation card with old/new preview                       |
| 10 | Chat: `@pilotcode run "npm list" in this project and summarize`                                          | `run_terminal_command` confirmation card → after approval, stdout summarized                      |
| 11 | After a multi-tool turn, check Output channel                                                           | `chat (agent): N iter, M tool call(s), C chars in Tms (first activity Fms, model=…)`              |
| 12 | Mid-stream: press the stop button in the Chat input                                                     | Loop halts immediately; no orphaned model / tool calls                                            |
| 13 | Set `pilotcode.agent.enabled` to `false`, ask `@pilotcode hi`                                            | Falls back to plain streaming (no tools), Output logs `chat: streamed N chars …` (no "agent")     |
| 14 | Re-enable agent, set `pilotcode.agent.maxIterations` to `1`, ask something that needs 2+ tool calls    | Chat shows the "⚠️ Stopped after 1 agent iteration(s)" notice                                     |

If 1–12 pass, Phase 4 is verified.

### Phase 4 troubleshooting

| Symptom | Fix |
| --- | --- |
| Agent never calls a tool, just chats | Your chat model may not support OpenAI-style function calling. Try `qwen2.5-coder:7b` (best), `qwen2.5:7b`, or `llama3.1:8b-instruct`. Smaller models often "forget" to use tools. |
| Confirmation card doesn't appear before destructive tool | VS Code only renders chat-inline confirmation when invoked via `vscode.lm.invokeTool` with `toolInvocationToken` (which we do). Ensure you're on VS Code 1.95+. |
| Tool throws "No workspace open" | Open a folder before chatting (`File → Open Folder…`). |
| Agent loops forever doing the same thing | Lower `pilotcode.agent.maxIterations` to 3; rephrase the prompt; or switch to a larger model. |
| `run_terminal_command` returns nothing on Windows | Check the command works in a normal PowerShell. Some Windows commands need `cmd /c …`. |

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
│   ├── extension.ts                 # activate() / deactivate(), commands, prewarm
│   ├── chat/                        # ── Phase 1 + Phase 3 ──
│   │   ├── participant.ts            #   @pilotcode streaming chat participant
│   │   ├── participantId.ts          #   shared id constant
│   │   ├── contextBuilder.ts         #   history + active editor + #file refs
│   │   └── slashCommands.ts          #   /explain /fix /test /refactor
│   ├── completions/                 # ── Phase 2 ──
│   │   ├── inlineProvider.ts         #   InlineCompletionItemProvider
│   │   ├── contextGatherer.ts        #   prefix/suffix windowing
│   │   ├── promptStrategies.ts       #   FIM + instruct prompts, lang stops
│   │   └── debouncer.ts              #   debounce + cancellation
│   ├── model/                       # ── shared model layer ──
│   │   ├── types.ts                  #   ChatMessage + ToolCall + OpenAITool
│   │   ├── completionClient.ts       #   non-streaming /completions + /chat
│   │   ├── chatClient.ts             #   streaming + non-streaming /chat
│   │   └── warmup.ts                 #   background prewarm on activate
│   ├── agent/                       # ── Phase 4 ──
│   │   ├── types.ts                  #   ToolDescriptor + ToolDefinition
│   │   └── loop.ts                   #   ReAct loop
│   ├── tools/                       # ── Phase 4 ──
│   │   ├── index.ts                  #   registerAllTools
│   │   ├── util.ts                   #   path guard + result helpers
│   │   ├── readFile.ts               #   read_file
│   │   ├── listDirectory.ts          #   list_directory
│   │   ├── grepWorkspace.ts          #   grep_workspace
│   │   ├── writeFile.ts              #   write_file (destructive)
│   │   ├── applyDiff.ts              #   apply_diff (destructive)
│   │   └── runTerminal.ts            #   run_terminal_command (destructive)
│   ├── commands/diagnose.ts         # PilotCode: Diagnose
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
