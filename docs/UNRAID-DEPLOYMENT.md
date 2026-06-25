# PrimeLoop on Unraid Deployment Guide

This guide walks through deploying PrimeLoop to your Unraid server (192.168.20.14).

## Prerequisites

- ✅ Unraid server running at 192.168.20.14
- ✅ Docker enabled on Unraid
- ✅ SSH access to Unraid (`ssh root@192.168.20.14`)
- ✅ At least 4GB RAM available (8GB recommended for agents)
- ✅ 20GB+ free disk space for volumes

---

## Quick Start

```bash
# SSH to your Unraid server
ssh root@192.168.20.14

# Create the appdata directory structure
mkdir -p /mnt/user/appdata/primeloop/{postgres,workspace,catalog}

# Clone the repo
cd /mnt/user/appdata
git clone <repo-url> primeloop
cd primeloop

# Copy environment template
cp .env.example .env

# Edit .env with your settings (see Configuration section below)
nano .env

# Start PrimeLoop
docker compose -f docker-compose.yml -f docker-compose.unraid.yml up -d --build
```

---

## Directory Structure

Unraid volumes are mounted to `/mnt/user/appdata/primeloop/`:

| Path | Purpose | Size Recommendation |
|------|---------|---------------------|
| `/mnt/user/appdata/primeloop/postgres` | PostgreSQL database | 5GB |
| `/mnt/user/appdata/primeloop/workspace` | Agent worktrees | 10GB+ |
| `/mnt/user/appdata/primeloop/catalog` | Agent templates (read-only) | 1GB |

---

## Configuration

### Required Environment Variables

Edit `.env` with:

```bash
# Database (required)
POSTGRES_PASSWORD=your-secure-password-here

# Encryption key (generate with: openssl rand -hex 32)
SECRET_ENCRYPTION_KEY=your-64-char-hex-key-here

# Optional: LangGraph API (if you have one)
LANGGRAPH_API_URL=http://192.168.20.14:8000

# Optional: Local LLM (Ollama on Unraid)
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=ollama
LOCAL_LLM_BASE_URL=http://192.168.20.14:11434
LOCAL_LLM_MODEL=llama3.1:8b-instruct-q4_K_M

# Optional: Cloud LLM providers (if you prefer)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Optional: Gitea integration
GITEA_TOKEN=

# Optional: Slack notifications
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
```

### Local LLM Setup

If you don't have Ollama running on Unraid yet:

```bash
# SSH to Unraid
ssh root@192.168.20.14

# Pull and run Ollama
docker run -d --name ollama -p 11434:11434 -v /mnt/user/appdata/ollama:/root/.ollama ollama/ollama

# Pull a model for PrimeLoop
docker exec ollama ollama pull llama3.1:8b-instruct-q4_K_M
```

Update `.env`:
```bash
LOCAL_LLM_ENABLED=1
LOCAL_LLM_TYPE=ollama
LOCAL_LLM_BASE_URL=http://192.168.20.14:11434
LOCAL_LLM_MODEL=llama3.1:8b-instruct-q4_K_M
```

---

## Advanced Configuration

### Enable Credential Broker (Recommended)

The credential broker issues short-lived, scoped credentials and keeps secrets out of config files:

```bash
# In .env
CREDENTIAL_BROKER=1
CONTROL_PLANE_URL=http://127.0.0.1:3100
```

### Enable Launcher for Isolated Runtimes (Optional)

The launcher provisions isolated runtime containers for agents:

```bash
# In .env
LAUNCHER_ENABLED=1
LAUNCHER_AUTH_SECRET=$(openssl rand -hex 32)
EGRESS_SANDBOX=1
```

Then build and run with the launcher profile:

```bash
# Build runtime image
docker build -f runtime-image/Dockerfile -t primeloop-runtime:latest .

# Start with launcher
docker compose -f docker-compose.yml -f docker-compose.unraid.yml --profile launcher up -d --build
```

---

## Verification

### Check Services

```bash
# List containers
docker compose -f docker-compose.yml -f docker-compose.unraid.yml ps

# Expected output: postgres, backend, and optionally launcher should show "Up"
```

### Health Check

```bash
# Test API endpoint
curl http://192.168.20.14:3101/health

# Expected response: {"status":"ok"}
```

### View Logs

```bash
# Backend logs
docker compose -f docker-compose.yml -f docker-compose.unraid.yml logs -f backend

# Postgres logs
docker compose -f docker-compose.yml -f docker-compose.unraid.yml logs -f postgres
```

---

## First-Time Setup

1. **Access the dashboard**: http://192.168.20.14:3101
2. **Create admin account** on first visit
3. **Configure local LLM** in the setup flow (Ollama at http://192.168.20.14:11434)
4. **Test agent creation** with a simple "Hello World" agent

---

## Maintenance

### Update PrimeLoop

```bash
cd /mnt/user/appdata/primeloop

# Pull latest changes
git pull

# Stop services
docker compose -f docker-compose.yml -f docker-compose.unraid.yml down

# Rebuild and restart
docker compose -f docker-compose.yml -f docker-compose.unraid.yml up -d --build
```

### Backup Data

```bash
# Backup all volumes
tar czf /mnt/user/appdata/primeloop-backup-$(date +%Y%m%d).tar.gz \
  -C /mnt/user/appdata primeloop
```

### Restore from Backup

```bash
# Stop services first
docker compose -f docker-compose.yml -f docker-compose.unraid.yml down

# Extract backup
tar xzf /path/to/backup.tar.gz -C /mnt/user/appdata

# Restart
docker compose -f docker-compose.yml -f docker-compose.unraid.yml up -d
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose -f docker-compose.yml -f docker-compose.unraid.yml logs backend

# Common issue: port 3100 already in use
# Fix: Change port mapping in docker-compose.unraid.yml
```

### Database connection failed

```bash
# Verify Postgres is healthy
docker compose -f docker-compose.yml -f docker-compose.unraid.yml ps postgres

# Check Postgres logs
docker compose -f docker-compose.yml -f docker-compose.unraid.yml logs postgres
```

### Ollama not responding

```bash
# Test Ollama directly
curl http://192.168.20.14:11434/api/tags

# If not responding, restart Ollama container
docker restart ollama
```

---

## Unraid Tips

### Docker Template in Unraid UI

For easier management via Unraid web UI:

1. Go to **Docker** → **Templates**
2. Add new template with:
   - **Repository**: `primeloop/primeloop`
   - **Tag**: `latest`
3. Map volumes to your Unraid shares
4. Set environment variables from `.env`

### Performance Tuning

For better agent performance on Unraid:

1. **Dedicate RAM**: Allocate 4GB+ to the PrimeLoop container
2. **Use SSD cache**: If available, enable SSD cache for `/mnt/user/appdata`
3. **Network**: Ensure Unraid is on gigabit or better network

---

## Next Steps

After deployment:

1. ✅ Access http://192.168.20.14:3101
2. ✅ Complete initial setup wizard
3. ✅ Configure your first agent
4. ✅ Set up Gitea integration (optional)
5. ✅ Configure Slack notifications (optional)

---

## Support

- **Issues**: Check logs with `docker compose logs`
- **Documentation**: See `docs/` directory for detailed guides
- **Community**: Check homelab-infra repository for Unraid-specific tips
