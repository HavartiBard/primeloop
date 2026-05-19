# agent-control-plane

Multi-agent dashboard and control plane.

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
ACP_VM_IP=192.168.20.60 \
ACP_DEV_DATABASE_HOST=192.168.20.14 \
ACP_DEV_DATABASE_PORT=55433 \
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
TEST_DATABASE_URL='postgresql://agent_cp:agent_cp_dev@192.168.20.14:55433/agent_cp_dev' npm test
```

Use the hosted dev DB path carefully because those tests are not written as read-only checks.
