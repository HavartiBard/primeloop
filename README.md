# PrimeLoop

[![backend-tests](https://code.klsll.com/HavartiBard/primeloop/actions/workflows/backend-tests.yml/badge.svg?branch=main)](https://code.klsll.com/HavartiBard/primeloop/actions?workflow=backend-tests.yml)

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
./install.sh
```

`install.sh` generates the required secrets (`POSTGRES_PASSWORD`,
`SECRET_ENCRYPTION_KEY`, and the dashboard sign-in token
`PRIMELOOP_ADMIN_TOKEN`) into `.env`, picks a free port if 3100 is taken,
and runs `docker compose up -d --build`. It never overwrites values you have
already set, so you can pre-fill `.env` (e.g. `ANTHROPIC_API_KEY`, or
`LOCAL_LLM_*` for a local provider) before running it — or configure LLM
access later in the setup wizard, which auto-detects local servers like
Ollama and LM Studio.

The dashboard and API are then available at **http://localhost:3100** (health check:
`GET /health`). Sign in with the `PRIMELOOP_ADMIN_TOKEN` from `.env`, then the
setup wizard walks you through picking a provider. Database migrations run
automatically on startup.

```sh
docker compose logs -f backend   # follow logs
docker compose down              # stop (add -v to also drop the database volume)
```

For a production deployment using a pre-built image and persistent volumes, use
`docker-compose.prod.yml` instead.

### Known limitations (tester release)

- **Single-user.** One shared admin token; no user accounts or roles yet.
- **Experimental features ship off.** The launcher-managed runtime isolation
  (`LAUNCHER_ENABLED`, `--profile launcher`) and the spec-024 flags
  (`RESUME_ON_RESTART`, `LAZY_PROVISIONING`, `CREDENTIAL_BROKER`,
  `EGRESS_SANDBOX`) are under active development — leave them at their
  defaults unless you're specifically testing them.
- **Local models need real tool calling.** Prime plans by calling tools;
  models under ~7B params are warned/blocked. See
  [docs/local-llm-guide.md](docs/local-llm-guide.md) for models that work
  and the GPU gotchas.
- **`LANGGRAPH_API_URL` is optional** — ignore any older docs that call it
  required.

When reporting a bug, include the version (`curl localhost:3100/health`),
your LLM setup, and `docker compose logs backend`.

### Security

- **Do not expose the PrimeLoop port to the internet.** PrimeLoop drives
  agents that can run code and spend LLM credits; keep it on a LAN, VPN, or
  behind a reverse proxy with TLS + its own auth.
- Keep `PRIMELOOP_ADMIN_TOKEN` set. Without it the dashboard and API accept
  requests from anyone who can reach the port. Scripts authenticate with
  `Authorization: Bearer <token>`; the browser signs in once and holds an
  httpOnly session cookie.
- `SECRET_ENCRYPTION_KEY` encrypts provider API keys at rest in Postgres —
  back it up with the database; losing it orphans the stored secrets.

### Production deployment notes

**Prebuilt image path (recommended)**: set `PRIMELOOP_IMAGE` to a published PrimeLoop
image (e.g. `ghcr.io/<owner>/primeloop:latest`) and run:

```sh
cp .env.example .env
# set POSTGRES_PASSWORD, SECRET_ENCRYPTION_KEY, PRIMELOOP_IMAGE in .env
docker compose -f docker-compose.prod.yml up -d
```

By default all durable state (Postgres data, workspace files, catalog YAML) lives
under `./data` next to the compose file; override the location with
`PRIMELOOP_DATA_DIR`. The container itself is disposable.

**Catalog storage**: Agent templates (`backend/catalog/*.yaml`) must be on durable
storage. See [docs/runtime-packaging.md](docs/runtime-packaging.md) for setup options.

**Disposable container / durable state model**: The container payload is ephemeral.
Workspace files, database records, and catalog YAML are the durable surfaces for
customization and self-improvement.

**Site-specific deployments** (a particular host's IPs, volume paths, port
overrides, etc.) don't belong in the tracked compose files — keep them in an
untracked `docker-compose.override.yml` (repo root) or under `deploy/local/`
(gitignored). See [deploy/README.md](deploy/README.md).

### Required environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `POSTGRES_PASSWORD` | yes | Password for the bundled Postgres |
| `SECRET_ENCRYPTION_KEY` | yes | 64-char hex (`openssl rand -hex 32`) — encrypts stored secrets |
| `PRIMELOOP_ADMIN_TOKEN` | strongly recommended | Access token for the dashboard/API (`install.sh` generates one). Empty disables authentication |
| `PRIMELOOP_IMAGE` | yes, for `docker-compose.prod.yml` | Published image reference, e.g. `ghcr.io/<owner>/primeloop:latest` |
| `PRIMELOOP_DATA_DIR` | no | Host directory for durable state (default `./data`), `docker-compose.prod.yml` only |
| `PRIMELOOP_PORT` | no | Host port for the dashboard/API (default `3100`), `docker-compose.prod.yml` only |
| `PRIMELOOP_CORS_ORIGINS` | no | Only needed when the dashboard is served from a different origin than the API |
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

New runtime isolation features are **disabled by default** — the app runs its proven legacy paths until you opt in. If you enable `CREDENTIAL_BROKER`, also set `CONTROL_PLANE_URL=http://127.0.0.1:3100` so Prime can reach the in-process LLM proxy.

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

## Advanced Runtime Features

PrimeLoop includes optional advanced runtime capabilities that enhance security, reliability, and isolation:

### Feature flags

Enable these advanced features via environment variables:

| Flag | Description |
|------|-------------|
| `RESUME_ON_RESTART=1` | Recover in-flight delegations on boot instead of unconditionally failing them |
| `LAZY_PROVISIONING=1` | Opt into lease/on-demand durable runtime behavior |
| `CREDENTIAL_BROKER=1` | Issue short-lived, brokered credentials and keep secrets out of generated config files |
| `EGRESS_SANDBOX=1` | Enable runtime containment with default-deny egress controls |

**Note:** When using `CREDENTIAL_BROKER`, set `CONTROL_PLANE_URL=http://127.0.0.1:3100` so Prime can reach the in-process LLM proxy.

### Credential / proxy model

When `CREDENTIAL_BROKER=1` is enabled:

- Agent/provider credentials are broker-issued and injected through process environment variables (never written to disk)
- Generated files such as `opencode.json` do not contain brokered secret values
- Prime LLM calls route through `/internal/llm/:provider/*`
- The control-plane proxy is the sole raw provider-key holder for proxied providers
- MCP/control-plane runtime auth can use brokered launcher/control-plane tokens



## Launcher Path Deployment (Isolated Runtimes)

**Optional:** Launcher-managed isolated runtimes for managed local OpenCode agents.
By default agents run in-process (the proven legacy path). When enabled, instead of the backend
spawning `opencode serve` as a local child process, a dedicated `launcher` service provisions one
persistent isolated runtime container per agent (via Docker or OpenSandbox) and the backend
connects out over remote ACP. The backend remains the sole owner of agent records and worktree
creation/mutation; the launcher only mounts the assigned worktree.

> **Off by default.** A fresh install needs only `POSTGRES_PASSWORD` + `SECRET_ENCRYPTION_KEY` and runs agents in-process. The launcher is opt-in because it requires a runtime image you build yourself (`runtime-image/Dockerfile`) — there is no published default image.

### Enabling the launcher (opt-in)

1. Build a runtime image from `runtime-image/Dockerfile` and point `OPENSANDBOX_IMAGE_OPENCODE` at it.
2. Set `LAUNCHER_ENABLED=1` and a `LAUNCHER_AUTH_SECRET` in your `.env`.
3. Start with the `launcher` profile so the launcher service comes up alongside the backend:

   ```sh
   docker compose --profile launcher up -d --build
   ```

Configuration:

- `LAUNCHER_ENABLED` — `0` by default; set `1` to route managed local agents through the launcher
- `LAUNCHER_AUTH_SECRET` — bearer secret the backend uses to authenticate to the launcher (required when enabled)
- `LAUNCHER_URL` — backend → launcher base URL (default `http://launcher:8787`)
- `LAUNCHER_ADAPTER` — `docker` (default) or `opensandbox`
- `OPENSANDBOX_URL` / `OPENSANDBOX_API_KEY` / `OPENSANDBOX_IMAGE_OPENCODE` — used when the adapter is `opensandbox`

The `docker` adapter mounts the host Docker socket into the launcher so it can provision sibling
runtime containers.

### Runtime mode, rollout validation, and rollback

- `GET /api/runtime/mode` reports the active mode (`launcher-managed` | `backend-local`), whether the launcher is reachable, and whether a launcher rollout is **ready** (`rolloutReady`).
- **Rollback**: set `LAUNCHER_ENABLED=0` (and `EGRESS_SANDBOX=0`) and redeploy to return to the legacy backend-local runtime path.



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
