# agent-control-plane

Multi-agent dashboard and control plane.

## Backend Test Database

The backend integration tests require Postgres.

```sh
cd backend
npm run test:db:up
npm run test:db
npm run test:db:down
```

The test database runs on `localhost:55432` and stores data in tmpfs.
If Docker port publishing is not reachable from the local shell, run `npm run test:db:docker`
after `npm run test:db:up`; it runs the backend tests in a temporary Node container on the
same Docker network as Postgres.
