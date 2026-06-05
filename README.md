# PrimeLoop

Multi-agent dashboard and control plane.

## Installation

PrimeLoop ships as a single Docker image (React dashboard + Node control plane +
bundled agent runtimes) backed by PostgreSQL. The Docker Compose path below brings up
the full app — dashboard and API — on port `3100`.

### Prerequisites

- Docker and Docker Compose
- An LLM provider key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)
- For from-source development only: Node.js 22+

### Quick start (Docker Compose)

```sh
git clone <repo-url> primeloop
cd primeloop

# 1. Create your environment file
cp .env.example .env

# 2. Generate a 32-byte hex encryption key and add it to .env
echo "SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 3. Edit .env — set at minimum POSTGRES_PASSWORD, LANGGRAPH_API_URL,
#    and one provider key (ANTHROPIC_API_KEY or OPENAI_API_KEY)

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
| `LANGGRAPH_API_URL` | yes | LangGraph agent endpoint |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | one | Prime's LLM provider |
| `GITEA_TOKEN` | optional | Gitea integration for work tracking |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | optional | Slack notifications |

All Spec 024 managed-agent runtime features ship **disabled by default** (see
[Feature flags](#feature-flags)) — the app runs its proven legacy paths until you opt
in. If you enable `CREDENTIAL_BROKER`, also set `CONTROL_PLANE_URL=http://127.0.0.1:3100`
so Prime can reach the in-process LLM proxy.

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
