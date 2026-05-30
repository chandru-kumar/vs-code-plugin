# Changelog

All notable changes to Bosch-CoPilot will be documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-05-29

### Added — Multi-provider model support (Bosch Model Farm)
- **`bosch-copilot.apiType`** selects the endpoint family:
  `azure-openai` (default), `anthropic` (Vertex AI Claude),
  `vertex-openai` (Vertex OpenAI-compatible), `openai`
  (Ollama / LM Studio / vLLM).
- `buildRequestUrl()` builds the correct URL per type (Azure deployment
  path + `api-version`, Vertex `rawPredict`/`streamRawPredict`, generic).
- `bosch-copilot.apiKeyHeader` — send the key as `Authorization: Bearer …`
  (default) or via a custom header (e.g. the Bosch platform
  `genaiplatform-farm-subscription-key`).
- Full **Anthropic Messages API** translation: OpenAI ⇄ Anthropic for
  messages, tools, tool-results, and responses; Anthropic SSE streaming.
- **Reasoning-model handling** (`isReasoningModel`) — omits `temperature`
  for o-series / GPT-5-nano which only accept the default.
- **`max_completion_tokens` vs `max_tokens`** chosen automatically per
  provider (`maxTokensKey`).
- Request timeouts (300 s non-stream, 120 s stream) with clear messages.
- Masked API-key logging + explicit warning when no key is set.

### Added — Tool support hardening
- `ToolsNotSupportedError` — when a model rejects tool calling the agent
  loop falls back to plain streaming chat (with a notice) instead of
  failing.
- Empty-response detection in the agent loop and the streaming path.
- `stream.progress('Thinking…')` for immediate feedback.

### Added — Six code-analysis tools (12 tools total)
Built for tracing code flow and making precise edits:
- **`find_files`** — locate files by glob (fileSearch; names, not contents).
- **`read_file_range`** — read a specific 1-based line range with gutters.
- **`find_symbol`** — locate where a symbol is *defined* across the
  workspace (language-server `executeWorkspaceSymbolProvider`).
- **`document_outline`** — indented class/method/function outline of one
  file (`executeDocumentSymbolProvider`).
- **`find_references`** — all *usages* of a symbol (codeUsages;
  `executeReferenceProvider`) — the key code-flow tool.
- **`go_to_definition`** — resolve a usage to its definition
  (`executeDefinitionProvider`).

  The four language-server tools work out of the box for TypeScript /
  JavaScript; other languages need their VS Code language extension active.

### Changed
- **`grep_workspace`** gained `isRegex` and `caseInsensitive` options
  (still literal substring by default) and is now framed as the
  *content* search counterpart to `find_files`.
- **Uniform per-tool logging** — every tool invocation now logs to the
  Output channel via a wrapper in `registerAllTools`:
  `tool:<name> → invoke {args}` / `tool:<name> ✓ ok (Nms, C chars)` /
  `tool:<name> ✗ failed (Nms)`. Covers tools invoked through the agent
  loop *and* via `#tool` references.
- `ToolDefinition.factory` now receives the shared `Logger` (tools that
  don't need it ignore the argument).
- Default `chatModel` / `completionModel` / `endpoint` now target the
  Bosch Model Farm (GPT-4o-mini / GPT-5-nano).

## [0.4.1] - 2026-05-20

### Changed
- **Rebranded `PilotCode` → `Bosch-CoPilot`.** Renamed throughout with no
  behaviour change:
  - Display name → `Bosch-CoPilot`; output channel → `Bosch-CoPilot`.
  - Chat participant `@pilotcode` → `@bosch-copilot` (id `bosch-copilot.chat`).
  - All settings `pilotcode.*` → `bosch-copilot.*`.
  - All commands `pilotcode.*` → `bosch-copilot.*`.
  - Package `name` → `bosch-copilot`; extension id →
    `chandru-kumar.bosch-copilot`.
  - Language-model tool ids `pilotcode_*` → `bosch_copilot_*`
    (the `#read_file` etc. reference names are unchanged).
  - Internal identifiers `PilotCodeSettings` → `BoschCopilotSettings`,
    `PilotCodeInlineProvider` → `BoschCopilotInlineProvider`.
- ⚠️ **Breaking for existing installs:** the extension id changed, so any
  settings previously saved under `pilotcode.*` are orphaned — re-enter
  them under `bosch-copilot.*` (endpoint, models, etc.).

## [0.4.0] - 2026-05-17

### Added (Phase 4 — Agentic mode)
- **ReAct agent loop** (`src/agent/loop.ts`) — non-streaming chat with
  tools, executes any returned `tool_calls`, appends `role: 'tool'`
  messages, loops until the model produces a final answer with no tool
  calls (or hits `agent.maxIterations`).
- **Six local tools**, each implementing `vscode.LanguageModelTool` and
  registered via `vscode.lm.registerTool`. Declared in `package.json`
  `contributes.languageModelTools` so confirmation cards render natively
  in the chat:
  - `read_file(path)` — non-destructive
  - `list_directory(path)` — non-destructive
  - `grep_workspace(query, glob?, maxResults?)` — non-destructive, skips
    `node_modules`, `.git`, `dist`, `out`, `build`, `.venv`, `__pycache__`
    by default; auto-skips binary files
  - `write_file(path, content, createOnly?)` — **destructive, requires
    confirmation** with content preview
  - `apply_diff(path, oldText, newText)` — **destructive, requires
    confirmation** with diff preview; enforces unique-match safety
  - `run_terminal_command(command, cwd?, timeoutSeconds?)` —
    **destructive, requires confirmation**; returns stdout / stderr /
    exit code (capped at 2 MB, 30 s timeout)
- **Path-traversal guard** on all file-touching tools — workspace-relative
  only, no `..` escapes, no absolute paths.
- **Non-streaming `chat()` method** on `ChatClient` — supports `tools` +
  `tool_choice`, returns the full assistant message including any
  `tool_calls`.
- **Streaming + agent paths** in the chat participant — agent is enabled
  by default; turn off with `bosch-copilot.agent.enabled` to fall back to the
  Phase 3 streaming path.
- **In-chat tool UX** — each call renders as:
  - `🔧 read_file("src/app.ts")` while pending
  - `✅ read_file → 4231 chars` on success
  - `❌ tool_name failed: <error>` on failure
- **Iteration cap warning** — if the agent hits
  `bosch-copilot.agent.maxIterations` (default 5) the chat shows a clear
  "stopped after N iterations" note instead of silently stalling.
- **Two new settings**:
  - `bosch-copilot.agent.enabled` (boolean, default `true`)
  - `bosch-copilot.agent.maxIterations` (number, default 5, range 1–20)

### Changed
- `ChatMessage` extended to support `tool_calls` (on assistant turns) and
  `tool_call_id` / `name` (on tool turns).
- `OpenAITool` + `ToolCall` types added to `src/model/types.ts`.
- `registerChatParticipant` signature gained `tools: ToolDescriptor[]`
  parameter.

## [0.3.0] - 2026-05-16

### Added (Phase 3 — Streaming chat)
- **Streaming `ChatClient`** over `POST /chat/completions` with proper SSE
  parsing (`data:` lines, `[DONE]` terminator, `finish_reason` handling,
  partial-event buffering across reads). End-to-end cancellation aborts
  the HTTP request *and* cancels the body reader.
- **`@bosch-copilot` is now a real chat agent** — streams Markdown tokens
  into the Chat view as the model generates them, with first-token and
  total latency logged at INFO.
- **Slash commands** (declared in `package.json` and surfaced in the
  Chat input): `/explain`, `/fix`, `/test`, `/refactor`. Each rewrites
  the system prompt + user message for the specific task.
- **Chat context builder** — system prompt includes workspace name; user
  message auto-includes the active editor (file, language, selection if
  any); explicit `#file:` / `#selection` references are read and inlined
  (up to 5 files, 4 KB each).
- **Conversation history** — last 10 of-our-participant turns are
  re-serialised into the message array (Markdown response parts only).
- **Follow-up suggestions** under every reply: *Explain further*,
  *Write tests* (→ `/test`), *Refactor* (→ `/refactor`).
- **Helpful welcome card** when `@bosch-copilot` is invoked with no prompt
  and no slash command (lists the slash commands + tips, doesn't waste
  a model call).
- **Typed error handling in chat** — `ModelNotFoundError` renders a
  clear "model not found" message with *Run Diagnose* / *Open Settings*
  buttons instead of a stack trace.

### Added (Phase 2 polish)
- **Background prewarm on activation** — fires one tiny throw-away
  completion 2 s after activate() so Ollama loads the completion model
  into RAM. Eliminates the 10-30 s cold-load on the user's first real
  ghost-text request. Disable with `bosch-copilot.prewarmOnActivation`.
- **Language-aware FIM stop tokens** for Python, JS/TS, JSX/TSX, Java,
  C#, Go, Rust, C/C++, Ruby, PHP, Swift, Kotlin. Keeps completions from
  bleeding into the next class / function / module.
- **🎉 First-success marker** at INFO level on the very first
  successful completion of a session:
  `🎉 Bosch-CoPilot: first inline completion from 'qwen2.5-coder:1.5b-base' via http://localhost:11434/v1 succeeded (1240ms, fim). Inline completions are LIVE.`
  Resets on settings change so model switches re-celebrate.

### Changed
- `ChatMessage` moved to `src/model/types.ts` (shared between chat +
  completion). The old import path from `promptStrategies` still works
  via a re-export.
- Completion client now uses `fimStopTokensFor(languageId)` instead of
  the bare `FIM_STOP_TOKENS`.

## [0.2.1] - 2026-05-16

### Added
- **`Bosch-CoPilot: Diagnose`** command (also a button on every `@bosch-copilot`
  reply). One click checks the endpoint, lists installed models,
  validates the configured chat + completion models, suggests
  closest-match alternatives for typos, and fires a real test
  completion round-trip with timing. Results open in a markdown editor.
- `ModelNotFoundError` — a typed error thrown when the endpoint reports
  the model is missing. The inline provider catches it specifically and
  shows a one-time *"Run Diagnose / Open Settings"* warning instead of
  spamming the log with identical HTTP 404s.

### Changed
- **Inline-completion outcomes now log at `INFO`** (not `debug`) — at the
  default log level you now see lines like
  `inline: 1 suggestion in 1240ms (instruct, 18 chars)` and
  `inline: model returned empty/whitespace (820ms, instruct)`.
- Repeat errors with the same message are throttled to once per 30 s
  (no more 9× identical 404s).
- The inline provider now resets its caches and missing-model notifications
  whenever the user edits Bosch-CoPilot settings — so fixing a typo gives an
  immediate fresh start.
- Chat participant now offers a **Run Diagnose** button alongside the
  existing *Open Settings* / *Test Endpoint Connection* buttons.

## [0.2.0] - 2026-05-14

### Added (Phase 2 — Inline completions)
- `InlineCompletionItemProvider` delivering ghost-text completions
  (Tab to accept, Alt+] / Alt+[ to cycle alternatives).
- Two prompting strategies with auto-detection:
  - **FIM** (fill-in-the-middle) for `*-base` / `*-coder` models via
    `/completions` and Qwen FIM tokens.
  - **Instruct** for generic chat models (qwen3.5/3.6, llama3.1, …) via
    `/chat/completions` with a completion-style prompt.
- Async debouncer that cancels superseded keystrokes and bridges VS Code's
  `CancellationToken` to `AbortSignal` (no orphaned model requests).
- Context gatherer with line-count + hard char-budget windowing around the
  cursor (prefix gets the larger share).
- Multi-suggestion support (`bosch-copilot.completionCount`, parallel requests
  with a temperature spread, deduped).
- Single-entry result cache to skip duplicate round-trips.
- Reference-counted status-bar item (`$(rocket)` / `$(loading~spin)` /
  `$(circle-slash)`) — click to toggle.
- `Bosch-CoPilot: Toggle Inline Completions` command.
- 9 new `bosch-copilot.completion*` settings (strategy, debounce, max tokens,
  temperature, prefix/suffix lines, char budget, multiline, count).

## [0.1.0] - 2026-05-13

### Added (Phase 1 — Scaffolding)
- Initial extension manifest (`package.json`) with full `contributes.configuration`.
- `@bosch-copilot` chat participant (stub responder, will gain streaming + tools in later phases).
- Output channel + level-aware logger.
- Endpoint connection test command (`Bosch-CoPilot: Test Model Endpoint Connection`).
- `Open Settings` and `Show Output Channel` commands.
- esbuild bundling pipeline, strict TypeScript config, ESLint + Prettier.
- GitHub Actions CI matrix (Windows / Ubuntu / macOS).
- `.vscode/launch.json` for one-key F5 debug.
