# deploy/

Site-specific deployment files.

- `local/` is **gitignored** — put machine- or site-specific compose files,
  deployment guides, and overrides there (e.g. an Unraid compose file with your
  host paths and LAN addresses). Nothing personal belongs in tracked files.
- Generic deployment lives in the repo root: `docker-compose.yml` (build from
  source) and `docker-compose.prod.yml` (pre-built image via `PRIMELOOP_IMAGE`).
- For dev-machine volume overrides, use an untracked `docker-compose.override.yml`
  in the repo root — Docker Compose picks it up automatically.
