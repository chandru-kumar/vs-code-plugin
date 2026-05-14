# Changelog

All notable changes to PilotCode will be documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
