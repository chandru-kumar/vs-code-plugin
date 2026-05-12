# Changelog

All notable changes to PilotCode will be documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
