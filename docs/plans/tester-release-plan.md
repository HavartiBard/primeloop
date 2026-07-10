# Tester Release Plan

Goal: publish PrimeLoop so friendly testers can install it in their own
environments using either local LLMs (Ollama, LM Studio, vLLM, LiteLLM,
llama.cpp) or public providers (Anthropic, OpenAI).

Benchmark for ease of use (July 2026 survey): Hermes Agent (one-line curl
install, `hermes doctor` diagnostics), OpenClaw (detect-before-ask onboarding
wizard, live completion test, QuickStart vs Advanced tiers), Odysseus
(clone + compose up, auto-generated admin password printed in logs).
Design principle distilled from all three: **ask nothing the system can
detect, generate every secret the user would otherwise invent, and validate
with a live call before declaring setup done.**

## Phase 1 — Prove a fresh install works (in progress)

### Bootstrap improvements
- [ ] `install.sh`: copy `.env.example` → `.env` if missing; auto-generate
      `POSTGRES_PASSWORD` and `SECRET_ENCRYPTION_KEY` when empty; detect a
      port-3100 conflict and pick/suggest a free `PRIMELOOP_PORT`; then
      `docker compose up -d --build`. Idempotent — safe to re-run.
- [ ] `extra_hosts: host.docker.internal:host-gateway` on the backend service
      (compose + prod compose) so a host-side Ollama/LM Studio is reachable
      from inside the container.
- [ ] Local-LLM discovery probes `host.docker.internal` by default when no
      `LOCAL_LLM_HOST`/`LOCAL_LLM_BASE_URL` is set (currently probes nothing
      unless env vars are provided).
- [x] QuickStart setup tier: `GET /api/setup/detect` scans env keys + local
      endpoints (parallel probe, models listed, false-positive guard requiring
      a real models-list shape); wizard opens with a Quick start / Advanced
      chooser; Quick start asks only provider + model, gates launch on the
      live probe, and lands in the dashboard. Validated in headless Chromium
      end to end (2026-07-10). Known quirk (pre-existing): the wizard's
      post-launch/team-plan panel unmounts when setup-status refetches as
      complete; reachable via `?setup=1`.
- [ ] Live validation gate: real completion + tool-call round-trip against
      the chosen model before setup can complete, with recommended-model
      hints when a local model fails the tool-call test.

### Fresh-install validation
- [x] Clean-copy test (local-LLM path): `./install.sh` → build → healthy
      backend on empty DB → wizard completion via API with a host Ollama
      provider → Prime launched. 2026-07-09.
- [x] Prime round trip through the local LLM verified: `prime.message` →
      event queue → LLM router → host Ollama (qwen2.5:32b) → reply in thread.
      Note: `POST /api/threads/:id/messages` only inserts; Prime is notified
      via `POST /api/threads/:id/prime/messages`.
- [x] Repeatable smoke-test script: `scripts/smoke-test.sh` (read-only checks
      always; live provider probe + full setup → Prime round trip via
      `SMOKE_PROVIDER_*` env vars).
- [ ] Repeat via the actual web wizard UI (browser walk-through).
- [ ] Repeat cloud-key path (ANTHROPIC_API_KEY) — no key available in this
      environment; run `SMOKE_PROVIDER_TYPE=anthropic` smoke test when one is.

### Fresh-install bugs found & fixed (2026-07-09)
1. **Migrations crash on an empty database** — `prime_agent_module_templates`
   had an inline FK to `prime_agent_module_versions`, created 10 lines later.
   Never surfaced on long-lived dev DBs (`IF NOT EXISTS` skipped it). Fixed
   with the same deferred-FK DO-block pattern the catalog tables use.
2. **Production image missing `prompts/` and `catalog/`** — Dockerfile stage 3
   only copied `dist` + `public`; setup completion failed with ENOENT on
   `/app/prompts/config/providers.yaml`. Fixed: image now ships `prompts/`
   and `catalog-defaults/`; entrypoint seeds `/app/catalog` when empty.
3. **Catalog mount-path mismatch** — code resolves the catalog at
   `/app/catalog`, but docker-compose.prod.yml (and docs, and the startup
   warning text) mounted/referenced `/app/backend/catalog`, so the durable
   volume was never actually read. All references fixed to `/app/catalog`.
4. **Local-LLM probe cold-start timeout** — first request to Ollama loads the
   model (minutes for 20GB+); probe timeout raised 30s → 120s with a
   "model may still be loading" hint.

Pre-existing, not fixed here: 7 failing unit tests in
`backend/tests/prime-agent/modules/` (module registry/fleet-state), present
on a clean tree before these changes.

## Phase 2 — Minimum security for other people's networks
- [x] Admin access token (`PRIMELOOP_ADMIN_TOKEN`): install.sh generates it
      into .env; backend middleware gates /api, /events, /agents, and the
      WebSocket. Dashboard shows a sign-in screen and holds an httpOnly
      session cookie (HMAC-derived — never the raw token); scripts use
      `Authorization: Bearer`. /health, static assets, and the per-agent
      `/internal/llm` proxy stay open. Validated: 401s, bearer, cookie login,
      cookie persistence across reload (headless Chromium), authed smoke test.
- [x] install.sh re-run safety: no longer treats its own running stack as a
      port conflict (was silently drifting 3100 → 3101 on updates).
- [x] Scrub personal defaults: `sender ?? 'james'` → `'operator'` in
      `backend/src/routes/runtime.ts`.
- [x] Log audit for secret leakage: no provider keys, tokens, or the
      encryption key are logged; no req.body/provider object dumps.
- [x] Spec-024 flags (RESUME_ON_RESTART, LAZY_PROVISIONING, CREDENTIAL_BROKER,
      EGRESS_SANDBOX) and LAUNCHER_ENABLED all default off in both compose
      files.
- [x] README: Security section (never expose the port; token semantics;
      SECRET_ENCRYPTION_KEY backup) + quick start rewritten around install.sh.
- [ ] Rotate the Gitea token embedded in the local git remote URL —
      **operator action**: revoke the token in Gitea, mint a fresh one, then
      `git remote set-url origin https://james:<new>@code.klsll.com/HavartiBard/primeloop.git`.

## Phase 3 — Publish the artifacts
- [x] LICENSE: Apache-2.0 (canonical text).
- [x] Multi-arch build (amd64 + arm64 via buildx/QEMU) in
      `.gitea/workflows/release-image.yml`, with `PRIMELOOP_VERSION` baked in.
- [x] `GET /health` reports the build version (Phase 5 item, pulled forward).
- [x] CHANGELOG.md started for v0.1.0.
- [x] Publishing runbook: `docs/publishing.md` — GitHub repo + Gitea push
      mirror + GHCR secrets + per-release tag loop.
- [ ] **Operator actions** (see docs/publishing.md): create the GitHub repo,
      set up the Gitea push mirror, add the three RELEASE_* secrets, make the
      GHCR package public after first push.
- [ ] Tag `v0.1.0`; verify `docker-compose.prod.yml` against the published
      image (blocked on the operator actions above).

## Phase 4 — Tester-facing docs
- [x] README quick start rewritten around `./install.sh` (single happy path;
      wizard handles LLM choice).
- [x] Local-LLM guide: `docs/local-llm-guide.md` — recommended tool-calling
      models with VRAM sizes, plus the gotchas hit during validation (cold
      loads, Ollama keep_alive, shared-GPU OOM, host.docker.internal,
      server-side tool support).
- [x] Known limitations section in README (single-user, experimental flags,
      local-model floor, LANGGRAPH optional).
- [x] Spec-025 setup guide marked internal/stale with a banner.
- [x] Feedback template: `.github/ISSUE_TEMPLATE/bug_report.md` (version,
      install method, LLM setup, logs).

## Phase 5 — Tester loop
- [ ] Pin testers to version tags, not `:latest`; keep a short CHANGELOG.
- [ ] Feedback channel (GitHub issues on the public mirror).
- [ ] `GET /health` reports build version so bug reports self-identify.

## Install-config information model

| Tier | Item | How |
|------|------|-----|
| 0 — generate, never ask | POSTGRES_PASSWORD, SECRET_ENCRYPTION_KEY | install.sh writes into .env |
| 0 | Admin token | first boot, printed in logs |
| 0 | Port conflict | install.sh detects, picks free port |
| 1 — detect, confirm | Env API keys (ANTHROPIC/OPENAI) | offered as pre-configured providers |
| 1 | Local LLM endpoints | probe host.docker.internal ports 11434/1234/8000/4000 |
| 1 | Model capability | live completion + tool-call test, pass/fail shown |
| 2 — ask (QuickStart) | Default provider/model | one pick from validated list |
| 2 | Workspace | default local path, optional git URL |
| 3 — default, edit later | Persona, rules, budgets, routing matrix, plugins, Slack/Gitea, catalog git source, CORS, experimental flags | Settings/admin panel |
