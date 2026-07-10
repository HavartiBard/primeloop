# Publishing runbook (GitHub mirror + GHCR)

One-time setup to publish PrimeLoop for testers, followed by the per-release
loop. The private Gitea (`code.klsll.com`) stays the origin; GitHub is a
public mirror and the tester-facing front door.

## One-time setup

### 1. Create the public GitHub repo

- github.com → New repository → `primeloop`, public, **empty** (no README).

### 2. Configure the Gitea push mirror

Gitea → repo → Settings → Repository → Mirror Settings → *Push Mirror*:

- Git remote address: `https://github.com/<you>/primeloop.git`
- Username: your GitHub username
- Password: a GitHub PAT with `repo` (classic) or `contents:write`
  (fine-grained) scope
- Sync when commits are pushed: ✓

Every push to Gitea then propagates to GitHub automatically.

### 3. Create the GHCR credentials + workflow secrets

- GitHub → Settings → Developer settings → Personal access tokens →
  classic token with `write:packages` scope.
- Gitea → repo → Settings → Actions → Secrets, add:
  - `RELEASE_IMAGE` = `ghcr.io/<you>/primeloop`
  - `RELEASE_REGISTRY_USER` = your GitHub username
  - `RELEASE_REGISTRY_TOKEN` = the packages PAT
- After the first publish: GitHub → the package → change visibility to
  **public** so testers can pull without auth.

### 4. Rotate the leaked Gitea token (if not done yet)

The old remote URL embedded a Gitea token. Revoke it in Gitea →
Settings → Applications, mint a fresh one, then:

```sh
git remote set-url origin https://james:<new-token>@code.klsll.com/HavartiBard/primeloop.git
```

## Per-release loop

1. Run the smoke test against a fresh install (see
   `scripts/smoke-test.sh` header for the provider env vars):
   ```sh
   ./scripts/smoke-test.sh
   ```
2. Update `CHANGELOG.md` (move "unreleased" to the release date).
3. Tag and push:
   ```sh
   git tag v0.1.0
   git push origin main --tags
   ```
   The `release-image` workflow builds amd64+arm64 and pushes
   `ghcr.io/<you>/primeloop:v0.1.0` + `:latest`, with the version baked in
   (`curl /health` → `{"status":"ok","version":"v0.1.0"}`).
4. Point testers at the README quick start. Pin them to the version tag,
   not `:latest`:
   ```sh
   # testers, using the prebuilt image:
   PRIMELOOP_IMAGE=ghcr.io/<you>/primeloop:v0.1.0 ./install.sh --prod
   ```

## Tester feedback

Issues live on the GitHub mirror. The issue template asks for the version
(`curl localhost:3100/health`), the LLM setup, and
`docker compose logs backend` output.
