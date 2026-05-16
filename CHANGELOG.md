# Changelog

All notable changes to PilotCode will be documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-16

### Added (Phase 3 — Streaming chat)
- **Streaming `ChatClient`** over `POST /chat/completions` with proper SSE
  parsing (`data:` lines, `[DONE]` terminator, `finish_reason` handling,
  partial-event buffering across reads). End-to-end cancellation aborts
  the HTTP request *and* cancels the body reader.
- **`@pilotcode` is now a real chat agent** — streams Markdown tokens
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
- **Helpful welcome card** when `@pilotcode` is invoked with no prompt
  and no slash command (lists the slash commands + tips, doesn't waste
  a model call).
- **Typed error handling in chat** — `ModelNotFoundError` renders a
  clear "model not found" message with *Run Diagnose* / *Open Settings*
  buttons instead of a stack trace.

### Added (Phase 2 polish)
- **Background prewarm on activation** — fires one tiny throw-away
  completion 2 s after activate() so Ollama loads the completion model
  into RAM. Eliminates the 10-30 s cold-load on the user's first real
  ghost-text request. Disable with `pilotcode.prewarmOnActivation`.
- **Language-aware FIM stop tokens** for Python, JS/TS, JSX/TSX, Java,
  C#, Go, Rust, C/C++, Ruby, PHP, Swift, Kotlin. Keeps completions from
  bleeding into the next class / function / module.
- **🎉 First-success marker** at INFO level on the very first
  successful completion of a session:
  `🎉 PilotCode: first inline completion from 'qwen2.5-coder:1.5b-base' via http://localhost:11434/v1 succeeded (1240ms, fim). Inline completions are LIVE.`
  Resets on settings change so model switches re-celebrate.

### Changed
- `ChatMessage` moved to `src/model/types.ts` (shared between chat +
  completion). The old import path from `promptStrategies` still works
  via a re-export.
- Completion client now uses `fimStopTokensFor(languageId)` instead of
  the bare `FIM_STOP_TOKENS`.

## [0.2.1] - 2026-05-16

### Added
- **`PilotCode: Diagnose`** command (also a button on every `@pilotcode`
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
  whenever the user edits PilotCode settings — so fixing a typo gives an
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
- Multi-suggestion support (`pilotcode.completionCount`, parallel requests
  with a temperature spread, deduped).
- Single-entry result cache to skip duplicate round-trips.
- Reference-counted status-bar item (`$(rocket)` / `$(loading~spin)` /
  `$(circle-slash)`) — click to toggle.
- `PilotCode: Toggle Inline Completions` command.
- 9 new `pilotcode.completion*` settings (strategy, debounce, max tokens,
  temperature, prefix/suffix lines, char budget, multiline, count).

## [0.1.0] - 2026-05-13

### Added (Phase 1 — Scaffolding)
- Initial extension manifest (`package.json`) with full `contributes.configuration`.
- `@pilotcode` chat participant (stub responder, will gain streaming + tools in later phases).
- Output channel + level-aware logger.
- Endpoint connection test command (`PilotCode: Test Model Endpoint Connection`).
- `Open Settings` and `Show Output Channel` commands.
- esbuild bundling pipeline, strict TypeScript config, ESLint + Prettier.
- GitHub Actions CI matrix (Windows / Ubuntu / macOS).
- `.vscode/launch.json` for one-key F5 debug.
