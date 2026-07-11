# Changelog

## v0.1.0 — first tester release (2026-07-11)

First release intended for installation outside the author's environment,
using either local LLMs (Ollama, LM Studio, vLLM, llama.cpp, LiteLLM) or
cloud providers (Anthropic, OpenAI).

### Install & onboarding
- `install.sh`: zero-question bootstrap — generates `POSTGRES_PASSWORD`,
  `SECRET_ENCRYPTION_KEY`, and `PRIMELOOP_ADMIN_TOKEN` into `.env`, picks a
  free port on conflict, and starts the stack. Safe to re-run.
- QuickStart setup tier: the wizard scans for local LLM servers and cloud
  keys before asking anything, asks only for a provider + model, and gates
  launch on a live completion + tool-call test. Advanced setup retains the
  full walkthrough.
- Local LLM servers on the Docker host are reachable via
  `host.docker.internal` out of the box.

### Security
- Dashboard/API authentication via `PRIMELOOP_ADMIN_TOKEN` (browser sign-in
  with an httpOnly session cookie; `Authorization: Bearer` for scripts).
- Runtime-isolation features (spec 024) and the launcher remain opt-in and
  off by default.

### Fixes
- Migrations no longer crash on an empty database (circular FK ordering).
- The production image now ships the prompt templates and default agent
  catalog; the catalog volume mounts at the path the code actually reads.
- Local-LLM discovery no longer misidentifies generic web apps as LLM
  servers.

### Tooling
- `scripts/smoke-test.sh` pre-release validation (health, wizard endpoints,
  live provider probe, full setup → Prime round trip).
- `GET /health` reports the build version.
- Release workflow builds multi-arch images (amd64 + arm64).
