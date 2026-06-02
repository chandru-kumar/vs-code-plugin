# Bosch-CoPilot

> Local-first, offline-capable Copilot clone for VS Code — powered by
> Qwen 2.5/3-Coder via Ollama, LM Studio, vLLM, or any OpenAI-compatible
> endpoint. Inline completions, full chat sidebar, agentic tool-calling,
> and native Model Context Protocol (MCP) support.

**Status:** Phase 4 of 8 — agentic mode with ReAct loop + **13 local tools** (read/range/list/find-files/grep + code-flow analysis via find-symbol/outline/references/definition + write/diff/terminal + ask-followup), **reviewable staged edits** (native red/green diff + Apply/Discard), live progress messages, multi-provider model support (Azure OpenAI / Anthropic-Vertex / Vertex-OpenAI / generic OpenAI), plus everything from Phases 1–3.

---

## Why Bosch-CoPilot?

| Feature                       | Bosch-CoPilot                              | GitHub Copilot |
| ----------------------------- | -------------------------------------- | -------------- |
| Works fully offline           | ✅                                     | ❌             |
| Bring-your-own model          | ✅ (any OpenAI-compatible endpoint)    | ❌             |
| Zero telemetry by default     | ✅                                     | ❌             |
| Inline ghost-text completions | ✅ **(done — Phase 2)**                | ✅             |
| Chat participant + sidebar    | ✅ `@bosch-copilot`                        | ✅             |
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
  - or any remote OpenAI-compatible API (set `bosch-copilot.apiKey`).

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
2. A second VS Code window labeled **`[Extension Development Host]`** will open. This is where Bosch-CoPilot is now loaded.
3. The first time you press F5, the `npm: watch` build task starts in the background and produces `dist/extension.js`. Wait ~5 s the first time.

### 6. Use `@bosch-copilot` in chat

In the **Extension Development Host** window:

1. Open the **Chat** view (Ctrl+Alt+I, or click the Chat icon in the activity bar).
2. Type `@bosch-copilot hello` and press Enter.
3. You should see a Phase 1 response showing your current configuration, plus two action buttons (Open Settings, Test Endpoint Connection).

### 7. Test the endpoint connection

In the **Extension Development Host** window:

1. **`Ctrl+Shift+P`** → *Bosch-CoPilot: Test Model Endpoint Connection*.
2. With Ollama running, you should see *"endpoint reachable. Models: …"*.
3. If it fails, click **Show Logs** for details.

### 8. Configure

In the **Extension Development Host** window: **`Ctrl+,`** → search for `bosch-copilot`. You can change endpoint, models, temperature, etc. All settings live-update; no reload needed.

---

## Manual test checklist for Phase 1 (Windows)

| # | Action                                                                               | Expected                                                                    |
| - | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1 | `npm install` completes                                                              | No errors                                                                   |
| 2 | `npm run compile` succeeds                                                           | `dist/extension.js` created, no TS errors                                   |
| 3 | `npm run check-types` succeeds                                                       | No TS errors                                                                |
| 4 | Press **F5**                                                                         | Extension Development Host window opens                                     |
| 5 | In the host window: `@bosch-copilot hello`                                               | Markdown response appears with current endpoint / model                     |
| 6 | Click **Open Bosch-CoPilot Settings** button in chat                                     | Settings UI opens filtered to `bosch-copilot.*`                                 |
| 7 | Change `bosch-copilot.chatModel` to anything                                             | The next `@bosch-copilot` reply reflects the new model name (no reload needed)  |
| 8 | `Ctrl+Shift+P` → *Bosch-CoPilot: Test Model Endpoint Connection* (Ollama running)        | Toast: "endpoint reachable. Models: qwen2.5-coder:…"                        |
| 9 | `Ctrl+Shift+P` → *Bosch-CoPilot: Show Output Channel*                                    | Output panel shows the `Bosch-CoPilot` log channel with INFO entries            |
| 10| Stop Ollama / change endpoint to `http://localhost:9999` → run *Test Connection*     | Error toast appears with **Open Settings** / **Show Logs** actions          |

If all 10 pass, Phase 1 is verified.

---

## ✨ Phase 2 — Inline completions (ghost text)

Phase 2 adds Copilot-style ghost text: as you type, Bosch-CoPilot asks your
local model to complete the code at the cursor and shows the suggestion
inline. Press **Tab** to accept, **Esc** to dismiss, **Alt+]** / **Alt+[**
to cycle alternatives.

### How it works

- **Two prompting strategies, auto-selected** by `bosch-copilot.completionStrategy`:
  - `fim` — fill-in-the-middle via `/completions`, for `*-base` / `*-coder`
    models (e.g. `qwen2.5-coder:1.5b-base`). Highest quality for code.
  - `instruct` — a completion-style prompt via `/chat/completions`, works
    with any chat model (`qwen3.5:latest`, `qwen3.6:latest`, `llama3.1`, …).
  - `auto` (default) picks `fim` when the model name contains `base`/`coder`,
    otherwise `instruct`.
- **Debounced** (`bosch-copilot.completionDebounceMs`, default 250 ms) so the
  local model isn't hammered on every keystroke; superseded requests are
  cancelled and their network calls aborted.
- **Context-aware** — sends N lines before/after the cursor
  (`completionPrefixLines` / `completionSuffixLines`), hard-capped by
  `completionMaxContextChars`.
- **Multi-suggestion** — set `bosch-copilot.completionCount` to 2–3 for
  alternatives (parallel requests; slower on local models).
- **Status bar item** — bottom-right `$(rocket) Bosch-CoPilot` (idle),
  `$(loading~spin) Bosch-CoPilot` (generating), `$(circle-slash) Bosch-CoPilot`
  (disabled). Click it to toggle completions.

> **Which model?** Your machine has `qwen3.5:latest` / `qwen3.6:latest`
> (chat models) → `auto` resolves to **instruct** mode and works out of the
> box. For noticeably sharper completions, pull a base coder model and
> point `bosch-copilot.completionModel` at it:
> ```powershell
> ollama pull qwen2.5-coder:1.5b-base
> ```
> then set `bosch-copilot.completionModel` = `qwen2.5-coder:1.5b-base`
> (`auto` will switch to FIM mode automatically).

### Manual test checklist for Phase 2 (Windows)

Do these in the **Extension Development Host** window, with Ollama running.

| #  | Action                                                                                          | Expected                                                                          |
| -- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1  | `git pull` the `feature/inline-completions` branch, `npm install`, `npm run compile`            | Clean build, `dist/extension.js` updated                                          |
| 2  | Press **F5**                                                                                    | Extension Development Host opens; bottom-right shows **`$(rocket) Bosch-CoPilot`**     |
| 3  | First set `bosch-copilot.completionModel` to `qwen3.6:latest` (a model you actually have)           | Setting saved (no reload needed)                                                  |
| 4  | Create a new file `test.js`, type `function add(a, b) {` and press **Enter**                    | After ~0.3–2 s, grey ghost text appears suggesting the body                       |
| 5  | Press **Tab**                                                                                   | Ghost text is inserted as real code                                               |
| 6  | Type a comment `// reverse a string` then Enter                                                 | Ghost text suggests a reverse-string implementation                               |
| 7  | While ghost text is showing, keep typing                                                        | Old suggestion is dropped, a new one is requested (debounced) — no lag/freeze      |
| 8  | Watch the status bar while a completion generates                                               | It briefly shows **`$(loading~spin) Bosch-CoPilot`**, then back to `$(rocket)`         |
| 9  | `Ctrl+Shift+P` → *Bosch-CoPilot: Toggle Inline Completions* (or click the status bar item)          | Toast confirms "disabled"; status bar shows **`$(circle-slash) Bosch-CoPilot`**; typing produces no ghost text |
| 10 | Toggle it back on; set `bosch-copilot.completionCount` to `3`, type a function signature, press **Alt+]** | Cycles through up to 3 alternative completions                              |
| 11 | `Ctrl+Shift+P` → *Bosch-CoPilot: Show Output Channel*, set `bosch-copilot.logLevel` to `debug`, type to trigger a completion | Log shows lines like `inline: 1 suggestion(s) in NNNms (instruct)`     |
| 12 | Set `bosch-copilot.completionModel` to a non-existent model, type to trigger                        | No ghost text, no crash; Output channel logs an HTTP 404 error                    |

If 1–11 pass, Phase 2 is verified. (Step 12 just confirms graceful failure.)

**Please paste the Output channel logs** (with `logLevel` = `debug`) after
running through this — especially the `inline: … (instruct)` lines and any
errors — so I can verify timing/strategy on your Windows box.

### Phase 2 troubleshooting

> 🩺 **First step for any issue: `Ctrl+Shift+P` → *Bosch-CoPilot: Diagnose*.**
> It checks the endpoint, validates your model names (and suggests fixes
> for typos like `qwen3.6:latesttt` → `qwen3.6:latest`), and fires a real
> test completion round-trip — all in one click. Results open in a
> markdown editor you can read, copy, or share.

| Symptom | Fix |
| --- | --- |
| No ghost text at all | Run **Bosch-CoPilot: Diagnose** — it catches all the common causes (wrong endpoint, missing/mis-typed model, model still cold-loading, competing extension, etc.). |
| Lots of HTTP 404s in Output | Almost always a typo in `bosch-copilot.completionModel`. Diagnose will print *"did you mean X?"* with the closest available model. |
| First completion after switching models takes 30+ s | Ollama is loading the model into RAM. Subsequent calls are fast. Pause typing so the first request isn't cancelled. |
| Ghost text is very slow | Lower `completionMaxTokens` (e.g. 128), use a smaller model, or raise `completionDebounceMs`. Local model speed is the bottleneck. |
| Completions repeat the code after the cursor | You're on a chat model in `instruct` mode — try a `*-coder` model with `auto`/`fim`. The suffix-overlap trimmer handles most cases but FIM is cleaner. |
| Completions are chatty / include prose | Same as above — chat models sometimes ignore the "code only" instruction. A base/coder model in FIM mode fixes this. |
| Completions wrapped in ```` ``` ```` fences | The instruct-output cleaner strips a single fence; if you still see them, the model added prose around it — switch to a coder model. |
| GitHub Copilot is installed and showing its own ghost text | In the Extension Development Host: `Ctrl+,` → search `github.copilot.enable` → set to `false`. Bosch-CoPilot then wins the inline-completion slot. |

---

## 💬 Phase 3 — Streaming chat + slash commands

`@bosch-copilot` is now a real chat agent — it streams Markdown into the Chat
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
  - The last 10 `@bosch-copilot` turns of conversation history are replayed.
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
and `bosch-copilot.chatModel` pointing at a model you actually have (e.g.
`qwen2.5-coder:7b` if pulled, or whatever `ollama list` shows).

| #  | Action                                                                                                          | Expected                                                                                          |
| -- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1  | `git pull`, `npm install`, `npm run compile`, press **F5**                                                      | Clean build; Extension Development Host opens                                                     |
| 2  | Within a few seconds of activation, watch Output: `Bosch-CoPilot: Show Output Channel`                              | `prewarm: warming completion model '…' on http://…` followed by `prewarm: '…' ready in NNNms`     |
| 3  | Open Chat (`Ctrl+Alt+I`), type just `@bosch-copilot` and press Enter                                                | Welcome card with the slash-command list, no model call made                                      |
| 4  | Type `@bosch-copilot Write a Python function that reverses a string`                                                | Markdown streams in token by token; a fenced Python block appears                                 |
| 5  | After it finishes, check Output                                                                                 | `chat: streamed N chars in NNNms (first token NNms, model=…)`                                     |
| 6  | Select some code in an editor, then in Chat type `@bosch-copilot /explain`                                          | Reply starts with a walkthrough of the selected code (and references it)                          |
| 7  | Type `@bosch-copilot /test` with a function selected                                                                | A unit-test file is generated in the appropriate framework for that language                      |
| 8  | Type `@bosch-copilot /refactor` with code selected                                                                  | Refactored code returned, followed by 2–3 bullets describing the changes                          |
| 9  | After step 6/7/8 finishes, you should see follow-up chips below the reply: 💡 Explain further / 🧪 Write tests / 🧹 Refactor | Click one — it sends a follow-up automatically                                          |
| 10 | While a streaming reply is in progress, press the stop button (square icon in Chat input) or `Esc`              | Streaming stops immediately; no orphaned model calls                                              |
| 11 | Set `bosch-copilot.chatModel` to `qwen3.6:latesttt` (typo) and ask a question                                       | Reply shows ❌ *"Model 'qwen3.6:latesttt' not found"* with Run Diagnose / Open Settings buttons   |
| 12 | Fix the typo, type a normal completion-triggering line in a file                                                | Output should show the 🎉 **first-success marker** line on the very first ghost text of the session |
| 13 | `ollama pull qwen2.5-coder:1.5b-base`, set `bosch-copilot.completionModel` to it, type some Python                  | Completions feel sharper; FIM stop tokens prevent run-on into the next `def`/`class`              |

If 1–10 pass cleanly, **Phase 3 is verified**. Steps 11–13 confirm the
Phase 2 polish landed too.

### Phase 3 troubleshooting

| Symptom | Fix |
| --- | --- |
| Chat reply is empty or "request failed" | Run **Bosch-CoPilot: Diagnose**. Most likely your `chatModel` setting points at a model you haven't pulled. |
| Reply streams very slowly | Use a smaller chat model (`qwen3.6:latest` instead of a 14B+). Or accept that local 7B+ models stream at ~30–50 tok/s on consumer hardware. |
| `/explain` / `/fix` / etc. don't appear when typing `/` | The slash commands are declared in `package.json` — reload the Extension Development Host (`Ctrl+R` inside it) after pulling a new version. |
| Cancel button doesn't stop generation | It should — we abort the HTTP request *and* cancel the body reader. If it doesn't, please file an issue with the Output log. |
| Prewarm log never appears | Either `bosch-copilot.prewarmOnActivation` is `false`, or `enableInlineCompletions` is `false`, or your endpoint is unreachable (Diagnose will tell you). |

---

## 🤖 Phase 4 — Agentic mode + local tools

`@bosch-copilot` is now an **agent**: it can *reason → call a tool → see the
result → reason again → ...* until it produces a final answer. Six tools
ship in-process; remote MCP tools come in Phase 5.

### How it works (ReAct loop)

```
You: "Read src/app.ts and tell me what it does"
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Bosch-CoPilot agent loop (max 5 iterations by default)           │
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

### The twelve built-in tools

**Read / explore (no confirmation):**

| Tool name          | What it does                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| `read_file`        | Read a whole workspace file (large files truncated).                            |
| `read_file_range`  | Read a specific 1-based line range with line-number gutters.                    |
| `list_directory`   | List immediate children of a directory (F/D/L markers).                         |
| `find_files`       | **fileSearch** — locate files by glob against their *names* (e.g. `**/*.ts`).   |
| `grep_workspace`   | **textSearch** — search file *contents* (literal or `isRegex`, `caseInsensitive`). |

**Code-flow analysis — language-server backed (no confirmation):**

| Tool name           | What it does                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `find_symbol`       | Where a symbol is **defined** across the workspace, by name.                 |
| `document_outline`  | Indented class/method/function outline of one file with line ranges.         |
| `find_references`   | **codeUsages** — every place a symbol is used (trace code flow).             |
| `go_to_definition`  | Resolve a usage to its definition (inverse of `find_references`).            |

**Mutate (always require a confirmation card):**

| Tool name              | What it does                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `write_file`           | Write/create a file. Confirmation card with content preview.             |
| `apply_diff`           | Replace a unique substring in a file. Confirmation card with diff preview.|
| `run_terminal_command` | Run a shell command; returns stdout/stderr/exit code. Confirmation card.  |

**Path safety:** all file tools reject absolute paths and `..` traversal —
nothing outside the workspace folder can be touched.

**Tool referencing:** every tool has `canBeReferencedInPrompt: true`, so you
can pin one with `#find_references` / `#read_file` etc. in chat to nudge the
agent toward it.

**Language-server tools require a language extension.** `find_symbol`,
`document_outline`, `find_references`, `go_to_definition` work out of the box
for **TypeScript / JavaScript** (built-in). For Python, Java, etc. install
that language's VS Code extension in the Extension Development Host first, or
they'll return "no results / no language server".

### Uniform tool logging

Every tool invocation is logged to the **Bosch-CoPilot** Output channel
(works for both agent-loop and `#tool` calls):

```
tool:find_references → invoke {"path":"src/agent/loop.ts","symbol":"AgentLoop"}
tool:find_references ✓ ok (142ms, 863 chars)
```

Failures log `tool:<name> ✗ failed (Nms)` with the error.

### Manual test plan (Windows) — agentic tools

Run in the **Extension Development Host** window. Because you're testing with
**GPT-4o-mini / GPT-5-nano** (fast, reliable tool calling) on the Bosch Model
Farm, set:

- `bosch-copilot.apiType` = `azure-openai`
- `bosch-copilot.endpoint`, `bosch-copilot.apiKey`, `bosch-copilot.apiKeyHeader`,
  `bosch-copilot.apiVersion` per your Farm config
- `bosch-copilot.chatModel` = your GPT-4o-mini / GPT-5-nano deployment name

> ⚠️ **Open a folder first** (`File → Open Folder…` → the cloned
> `vs-code-plugin` repo). The tools need a workspace. The TypeScript language
> server analyses this repo automatically, so the code-nav tools work on it.

**A. Setup & registration**

| #  | Action                                                                          | Expected                                                                                    |
| -- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1  | `git fetch && git checkout feature/agent-tools-complete && git pull && npm install && npm run compile` | Clean build                                                            |
| 2  | F5 → host → Output: *Bosch-CoPilot: Show Output Channel*                         | `Registered 12 tool(s): read_file, read_file_range, list_directory, find_files, grep_workspace, find_symbol, document_outline, find_references, go_to_definition, write_file, apply_diff, run_terminal_command` |
| 3  | Set `bosch-copilot.logLevel` = `debug`                                           | (so you see `tool:… → invoke` / `✓ ok` lines)                                               |

**B. Read / search tools**

| #  | Action                                                                          | Expected                                                                                    |
| -- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 4  | `@bosch-copilot find all TypeScript files under src/agent`                       | `🔧 find_files` → list incl. `src/agent/loop.ts`, `src/agent/types.ts`                       |
| 5  | `@bosch-copilot search for "executeReferenceProvider" in the codebase`           | `🔧 grep_workspace` → hit in `src/tools/findReferences.ts`                                   |
| 6  | `@bosch-copilot show lines 40-60 of src/agent/loop.ts`                            | `🔧 read_file_range` → those lines with gutters                                              |
| 7  | `@bosch-copilot using regex, find all TODO or FIXME comments`                     | `🔧 grep_workspace` with `isRegex:true` (e.g. `TODO|FIXME`)                                  |

**C. Code-flow analysis (the new power tools)**

| #  | Action                                                                          | Expected                                                                                    |
| -- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 8  | `@bosch-copilot where is the class AgentLoop defined?`                            | `🔧 find_symbol` → `class AgentLoop — src/agent/loop.ts:NN`                                  |
| 9  | `@bosch-copilot outline src/model/chatClient.ts`                                  | `🔧 document_outline` → indented list (ChatClient, chat, stream, chatAnthropic, …)           |
| 10 | `@bosch-copilot find all references to AgentLoop across the project`             | `🔧 find_references` → usages incl. `src/chat/participant.ts`                                |
| 11 | `@bosch-copilot in src/chat/participant.ts, where is AgentLoop defined? jump to it` | `🔧 go_to_definition` → `src/agent/loop.ts:NN`                                            |
| 12 | `@bosch-copilot trace how a chat request flows from the participant into the tools` | Multi-step: find_symbol / find_references / read_file_range chained, then a flow summary  |

**D. Editing (confirmation-gated)**

| #  | Action                                                                          | Expected                                                                                    |
| -- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 13 | `@bosch-copilot create scratch/hello.ts that logs "hi from bosch-copilot"`        | `write_file` **confirmation card** with preview → Continue → file on disk                    |
| 14 | Repeat a write, click **Cancel**                                                  | `❌ write_file failed: …declined…`; no file written                                          |
| 15 | `@bosch-copilot in scratch/hello.ts change the message to "patched"`              | `read_file` then `apply_diff` **confirmation card** (old/new preview) → Continue → patched   |
| 16 | `@bosch-copilot run "node -v" and tell me the version`                            | `run_terminal_command` **confirmation card** → after approval, version summarized            |

**E. Agent control & robustness**

| #  | Action                                                                          | Expected                                                                                    |
| -- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 17 | After a multi-tool turn, check Output                                            | `chat (agent): N iter, M tool call(s), …` + per-tool `tool:… ✓ ok (…ms, … chars)` lines     |
| 18 | Mid-run, press the **stop** (square) button in the chat input                   | Loop halts immediately; no orphaned calls                                                    |
| 19 | Set `bosch-copilot.agent.maxIterations` = `1`, ask a 2-tool question            | `⚠️ Stopped after 1 agent iteration(s)` notice                                               |
| 20 | Set `bosch-copilot.agent.enabled` = `false`, ask `@bosch-copilot hi`            | Plain streaming, Output logs `chat: streamed N chars …` (no `agent`)                         |

If A–E pass, the agentic-tools layer is verified. **Please send the Output
channel logs** (at `debug`) — especially the `Registered 12 tool(s)` line, the
`tool:… → invoke` / `✓ ok` lines, and any `✗ failed` errors.

### Tools troubleshooting

| Symptom | Fix |
| --- | --- |
| Code-nav tools return "no results / no language server" | The file's language extension isn't active. TS/JS work built-in; for Python etc. install that extension in the Extension Development Host. Also make sure the workspace folder is open so the language server can index it. |
| Agent never calls a tool, just chats | The model decided not to. GPT-4o-mini / GPT-5-nano are reliable; very small local models often skip tools. Confirm `bosch-copilot.chatModel` and `apiType` are correct (Diagnose helps). |
| `find_references` says "symbol not found" | Pass an explicit `line`, or use the exact identifier as it appears in the file. |
| Confirmation card doesn't appear before a write | Only renders when invoked via the agent loop (`toolInvocationToken`). Ensure VS Code 1.95+ and that the agent is enabled. |
| Tool throws "No workspace open" | Open a folder first (`File → Open Folder…`). |
| Agent loops repeating the same tool | Lower `bosch-copilot.agent.maxIterations`; rephrase; the model may be confused by ambiguous file paths. |

---

## ✨ Phase 4 polish — reviewable edits, live progress, smarter agent (v0.6.0)

Three upgrades to the agentic experience:

1. **Live progress messages** — the status line now changes as the agent
   works: `🧠 Reasoning…` → per-tool `🔍 Combing through the codebase…` /
   `🔗 Tracing every usage…` → `📋 Reviewing what I found…` → `🧾 Wrapping
   up…`. (The old duplicated, static "Thinking…" is gone.)

2. **Reviewable staged edits (diff tab + Apply/Discard)** — `write_file` and
   `apply_diff` no longer write immediately. The agent **stages** changes;
   at the end of the turn the chat shows a **Proposed changes** block:
   - every changed file with `+added / −removed`,
   - an **Open Diff** button per file → VS Code's native **red/green diff**,
   - **Apply All** (writes via `WorkspaceEdit`, full undo) and **Discard**.
   Nothing touches disk until you click Apply.

3. **Smarter agent** — `ask_followup_question` tool (the agent asks instead
   of guessing), a system prompt that traces **cross-file flow** (Angular:
   component → shared service → all consumers), a **duplicate-call guard**,
   and a **forced final answer** so you never get the old "did 5 tool calls,
   returned nothing" outcome. Default `maxIterations` raised to 10.

### Test plan (Windows) — Phase 4 polish

Agent mode must be on: `bosch-copilot.agent.enabled` = `true`. Open a real
project (your Angular app is ideal). `logLevel` = `debug`.

| #  | Action                                                                                              | Expected                                                                                          |
| -- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1  | `git fetch && git checkout feature/agent-ux-polish && git pull && npm install && npm run compile`   | Clean build                                                                                        |
| 2  | F5 → Output shows `Registered 13 tool(s): … ask_followup_question`                                  | New tool present                                                                                   |
| 3  | Ask a question that needs tools; watch the **status line** under the input                          | It changes through phases (🧠 / per-tool / 📋), not a static frozen "Thinking…"; appears **once**   |
| 4  | `@bosch-copilot in <some component> rename the field X to Y`                                          | Agent uses find_symbol/find_references/read_file_range, then **stages** an apply_diff               |
| 5  | After it finishes, you see a **📝 Proposed changes** block listing the file(s) with +/- counts       | Each file has an **Open Diff** button; **Apply All** + **Discard** below                            |
| 6  | Click **Open Diff** for a file                                                                       | VS Code's native diff opens — added lines **green**, removed **red**. Nothing written yet           |
| 7  | Click **Apply All**                                                                                 | Toast "applied N file change(s)"; files now changed on disk (and saved)                            |
| 8  | Repeat an edit, click **Discard**                                                                   | Toast "discarded N"; no file changed                                                                |
| 9  | **Multi-file flow:** "In `<service>` the value `foo` changed — update every component that uses it" | Agent traces references across files and stages edits to **multiple** files in one Proposed block   |
| 10 | Ask something ambiguous, e.g. "fix the reset bug" with several candidates                            | Agent calls `ask_followup_question` → a QuickPick/InputBox pops; your answer steers it              |
| 11 | Force the cap: set `maxIterations` = `2`, ask a 3-step task                                          | After the cap it still **prints a final answer** (forced), not "stopped, 0 chars"                  |
| 12 | Check Output after a turn                                                                            | `chat (agent): … staged=N …`; `tool:apply_diff` logs `Staged …`; any dedup logs `agent: dedup …`    |

If 1–9 pass, the polish milestone is verified. **Send the Output logs** —
especially `staged=N`, the `tool:apply_diff ✓` lines, and any
`agent: dedup` / forced-final-answer lines.

### Phase 4 polish troubleshooting

| Symptom | Fix |
| --- | --- |
| No "Proposed changes" block after an edit request | The model answered without calling an edit tool (it may have only *described* the change). Ask explicitly: "apply the change to the file". Check Output for `tool:apply_diff`. |
| "Open Diff" says the change is no longer available | You started a new chat turn (which clears the previous turn's staged edits). Re-run the request. |
| Apply All did nothing | Check Output for `editManager: failed to apply` — usually the file moved/was deleted. |
| `ask_followup_question` popup didn't appear | It uses VS Code's QuickPick/InputBox at the top-center; if you dismissed it, the agent proceeds with an assumption (and says so). |
| Edits applied immediately without review | You invoked the tool via `#write_file` **outside** an agent turn — the direct-write fallback ran. Use it inside `@bosch-copilot` agent mode for staging. |

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
│   │   ├── participant.ts            #   @bosch-copilot streaming chat participant
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
│   ├── tools/                       # ── Phase 4 (12 tools) ──
│   │   ├── index.ts                  #   registerAllTools + logging wrapper
│   │   ├── util.ts                   #   path guard, symbol/location helpers
│   │   ├── readFile.ts               #   read_file
│   │   ├── readFileRange.ts          #   read_file_range
│   │   ├── listDirectory.ts          #   list_directory
│   │   ├── findFiles.ts              #   find_files (fileSearch)
│   │   ├── grepWorkspace.ts          #   grep_workspace (textSearch + regex)
│   │   ├── findSymbol.ts             #   find_symbol (workspace symbols)
│   │   ├── documentOutline.ts        #   document_outline (file symbols)
│   │   ├── findReferences.ts         #   find_references (codeUsages)
│   │   ├── goToDefinition.ts         #   go_to_definition
│   │   ├── writeFile.ts              #   write_file (destructive)
│   │   ├── applyDiff.ts              #   apply_diff (destructive)
│   │   └── runTerminal.ts            #   run_terminal_command (destructive)
│   ├── commands/diagnose.ts         # Bosch-CoPilot: Diagnose
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

**`@bosch-copilot` does not appear in chat** — make sure you're in the
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
