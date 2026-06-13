# PrimeLoop

Multi-agent dashboard and control plane.

## Installation

PrimeLoop ships as a single Docker image (React dashboard + Node control plane +
bundled agent runtimes) backed by PostgreSQL. The Docker Compose path below brings up
the full app — dashboard and API — on port `3100`.

### Prerequisites

- Docker and Docker Compose
- Either a cloud LLM provider key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) or a local provider you will configure in setup
- For from-source development only: Node.js 22+

### Quick start (Docker Compose)

```sh
git clone <repo-url> primeloop
cd primeloop

# 1. Create your environment file
cp .env.example .env

# 2. Generate a 32-byte hex encryption key and add it to .env
echo "SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 3. Edit .env — set at minimum POSTGRES_PASSWORD.
#    LANGGRAPH_API_URL is optional.
#    For LLM access, either set a cloud provider key now
#    (ANTHROPIC_API_KEY or OPENAI_API_KEY), or configure a local provider
#    through LOCAL_LLM_* env vars and/or the setup flow.

# 4. Build and start (Postgres + backend + bundled dashboard)
docker compose up -d --build
```

The dashboard and API are then available at **http://localhost:3100** (health check:
`GET /health`). Database migrations run automatically on startup.

```sh
docker compose logs -f backend   # follow logs
docker compose down              # stop (add -v to also drop the database volume)
```

For a production deployment using a pre-built image and persistent volumes, use
`docker-compose.prod.yml` instead.

### Required environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `POSTGRES_PASSWORD` | yes | Password for the bundled Postgres |
| `SECRET_ENCRYPTION_KEY` | yes | 64-char hex (`openssl rand -hex 32`) — encrypts stored secrets |
| `LANGGRAPH_API_URL` | no | Optional LangGraph agent endpoint |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | optional | Cloud LLM provider key; not needed if you use a local provider |
| `LOCAL_LLM_ENABLED` | optional | Set to `1` to explicitly enable local-LLM bootstrap |
| `LOCAL_LLM_TYPE` | optional | `auto`, `ollama`, `llamacpp`, `litellm`, `vllm`, `lmstudio`, or `llm-proxy` |
| `LOCAL_LLM_BASE_URL` | optional | Full local endpoint URL, e.g. `http://localhost:11434` or `http://localhost:1234/v1` |
| `LOCAL_LLM_HOST` | optional | Host/IP only; PrimeLoop will probe common local-LLM ports/endpoints |
| `LOCAL_LLM_API_KEY` | optional | API key for a local proxy/OpenAI-compatible endpoint |
| `LOCAL_LLM_MODEL` | optional | Default model to prefill in setup |
| `GITEA_TOKEN` | optional | Gitea integration for work tracking |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | optional | Slack notifications |

All Spec 024 managed-agent runtime features ship **disabled by default** (see
[Feature flags](#feature-flags)) — the app runs its proven legacy paths until you opt
in. If you enable `CREDENTIAL_BROKER`, also set `CONTROL_PLANE_URL=http://127.0.0.1:3100`
so Prime can reach the in-process LLM proxy.

For local models, PrimeLoop can bootstrap the setup flow from `.env`. Supported local
provider modes include Ollama, llama.cpp, LiteLLM/LLM proxy, vLLM, and LM Studio.
Use `LOCAL_LLM_BASE_URL` when you know the exact endpoint, or `LOCAL_LLM_HOST` when you
want PrimeLoop to probe common ports such as Ollama (`11434`), LM Studio (`1234`),
vLLM (`8000`), llama.cpp (`8080`), and proxy-style OpenAI-compatible servers.

Examples:

#### Ollama

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=ollama
LOCAL_LLM_BASE_URL=http://localhost:11434
LOCAL_LLM_MODEL=qwen3:32b
```

#### llama.cpp

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=llamacpp
LOCAL_LLM_BASE_URL=http://localhost:8080
LOCAL_LLM_MODEL=qwen3-32b
```

#### LM Studio

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=lmstudio
LOCAL_LLM_BASE_URL=http://localhost:1234/v1
LOCAL_LLM_MODEL=local-model
```

#### vLLM

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=vllm
LOCAL_LLM_BASE_URL=http://localhost:8000/v1
LOCAL_LLM_MODEL=Qwen/Qwen3-32B
```

#### LiteLLM / local OpenAI-compatible proxy

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=litellm
LOCAL_LLM_BASE_URL=http://localhost:4000/v1
LOCAL_LLM_API_KEY=
LOCAL_LLM_MODEL=openai/gpt-4o-mini
```

#### Generic LLM proxy

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=llm-proxy
LOCAL_LLM_BASE_URL=http://localhost:4000/v1
LOCAL_LLM_API_KEY=optional-token
LOCAL_LLM_MODEL=my-model
```

#### Autodiscover from host/IP

```sh
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=auto
LOCAL_LLM_HOST=192.168.1.50
LOCAL_LLM_API_KEY=
```

Autodiscovery is best-effort. PrimeLoop probes common defaults such as:
- Ollama: `11434`
- LM Studio: `1234`
- vLLM: `8000`
- llama.cpp: `8080`
- proxy/OpenAI-compatible servers: `4000`, `3000`

If you already know the exact endpoint, prefer `LOCAL_LLM_BASE_URL` over host-only autodiscovery.

`VITE_LOCAL_AI_BASE_URL` remains available as a legacy dev-only Vite prefill, but Docker
installs should prefer the runtime `LOCAL_LLM_*` variables above.

### From source (development)

Run the backend and Vite dev server directly against a Postgres you provide:

```sh
# backend API on :3100 (needs DATABASE_URL + SECRET_ENCRYPTION_KEY in the environment)
cd backend && npm install && npm run dev

# web dashboard on :5173
cd web && npm install && npm run dev
```

The repo wrapper `./scripts/dev-up.sh` wires the expected env for the team's hosted dev
Postgres — see [Dev Startup](#dev-startup) below.

## Managed-Agent Runtime Alignment (Spec 024)

This branch is migrating PrimeLoop toward a managed-agent runtime model with:

- restart recovery for in-flight delegations
- brokered env-only credentials
- control-plane LLM proxying
- lazy durable runtime provisioning
- runtime containment / egress controls
- unified session timelines

### Feature flags

These flags are currently wired in `backend/src/index.ts`:

- `RESUME_ON_RESTART=1` — recover in-flight delegations on boot instead of unconditionally failing them
- `LAZY_PROVISIONING=1` — opt into lease/on-demand durable runtime behavior as it lands
- `CREDENTIAL_BROKER=1` — issue brokered runtime credentials and keep secrets out of generated config files
- `EGRESS_SANDBOX=1` — enable runtime containment / launcher transport work as it lands

### Credential / proxy model

Current direction for Spec 024:

- agent/provider credentials are broker-issued and injected through process env
- generated files such as `opencode.json` should not contain brokered secret values when broker mode is enabled
- Prime LLM calls route through `/internal/llm/:provider/*`
- the control-plane proxy is the sole raw provider-key holder for proxied providers
- MCP/control-plane runtime auth can use brokered launcher/control-plane tokens

### Runtime events added for Spec 024

The runtime event taxonomy now includes:

- `session.resumed`
- `delegation.recovered`
- `delegation.recovered_failed`
- `credential.issued`
- `credential.rotated`
- `credential.revoked`
- `credential.risk_flagged`
- `runtime.leased`
- `runtime.reclaimed`
- `egress.denied`
- `fs.denied`
- `llm.proxied`
- `launcher.auth_denied`

## Launcher Path Deployment (Spec 025)

Spec 025 makes **launcher-managed isolated runtimes the default execution path** for managed
local OpenCode agents. Instead of the backend spawning `opencode serve` as a local child
process, a dedicated `launcher` service provisions one persistent isolated runtime container
per agent (via Docker or OpenSandbox) and the backend connects out over remote ACP. The backend
remains the sole owner of agent records and worktree creation/mutation; the launcher only mounts
the assigned worktree.

### Deployment

`docker-compose.yml` and `docker-compose.prod.yml` now ship a `launcher` service alongside the
backend. The backend depends on it and is configured with:

- `LAUNCHER_ENABLED` — `1` by default in compose; selects launcher-managed runtime mode
- `LAUNCHER_URL` — backend → launcher base URL (default `http://launcher:8787`)
- `LAUNCHER_AUTH_SECRET` — **required**; bearer secret the backend uses to authenticate to the launcher
- `LAUNCHER_ADAPTER` — `docker` (default) or `opensandbox`
- `OPENSANDBOX_URL` / `OPENSANDBOX_API_KEY` / `OPENSANDBOX_IMAGE_OPENCODE` — used when the adapter is `opensandbox`

The `docker` adapter mounts the host Docker socket into the launcher so it can provision sibling
runtime containers.

### Runtime mode, rollout validation, and rollback

- `GET /api/runtime/mode` reports the active mode (`launcher-managed` | `backend-local`),
  whether the launcher is reachable, and whether a launcher rollout is **ready**
  (`rolloutReady`). At boot the backend emits `runtime.mode_active` plus
  `runtime.mode_rollout_validated` or `runtime.mode_rollout_blocked`.
- **Rollback**: set `LAUNCHER_ENABLED=0` (and `EGRESS_SANDBOX=0`) and redeploy to return to the
  legacy backend-local runtime path. `POST /api/runtime/mode/rollback` records an auditable
  `runtime.mode_rollback` event with an operator-supplied `reason`.

### Runtime events added for Spec 025

- `runtime.mode_active`
- `runtime.mode_rollout_validated`
- `runtime.mode_rollout_blocked`
- `runtime.mode_rollback`
- `launcher.runtime_provision` / `launcher.runtime_restart` / `launcher.runtime_teardown` / `launcher.runtime_recovery` / `launcher.runtime_status`

## Dev Startup

Use the repo wrapper so backend and web come up with the expected local dev settings:

```sh
./scripts/dev-up.sh
```

This script:

- clears stale listeners on backend port `3100` and web port `5173`
- starts the backend with the expected `DATABASE_URL` and `SECRET_ENCRYPTION_KEY`
- binds Vite on `0.0.0.0:5173` so the UI is reachable from the VM IP

Default assumptions:

- the shared hosted dev Postgres is reachable at `192.168.20.14:55433`
- backend listens on `3100`
- web listens on `5173`

Override with env vars as needed:

```sh
PRIMELOOP_VM_IP=192.168.20.60 \
PRIMELOOP_DEV_DATABASE_HOST=192.168.20.14 \
PRIMELOOP_DEV_DATABASE_PORT=55433 \
./scripts/dev-up.sh
```

## Backend Test Database

Backend runtime development and backend test verification are separate:

- normal app development uses the shared hosted dev database via `DATABASE_URL`
- DB-backed test runs use `TEST_DATABASE_URL`

There is no expectation that you run a local long-lived Postgres for day-to-day development.
The repo includes an optional disposable Docker test database for DB-backed backend tests, but
you can also point `TEST_DATABASE_URL` at the hosted dev database if that is the current team workflow.

Default disposable test DB workflow:

```sh
cd backend
npm run test:db:up
npm run test:db
npm run test:db:down
```

That disposable test database:

- runs on `localhost:55432`
- stores data in tmpfs
- is only for isolated backend test runs, not normal app development

If Docker port publishing is not reachable from the local shell, run `npm run test:db:docker`
after `npm run test:db:up`; it runs the backend tests in a temporary Node container on the
same Docker network as Postgres.

If you want DB-backed tests to run against the hosted dev database instead, override
`TEST_DATABASE_URL` explicitly:

```sh
cd backend
TEST_DATABASE_URL='postgresql://primeloop:primeloop_dev@192.168.20.14:55433/primeloop_dev' npm test
```

Use the hosted dev DB path carefully because those tests are not written as read-only checks.
