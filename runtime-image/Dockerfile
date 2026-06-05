# primeloop-runtime — single configurable agent-runtime image (FR-023, FR-024).
# Operator selects which runtimes to include via the RUNTIMES build arg.
# The setup script (scripts/setup.sh) stamps this into docker-compose.runtime.yml.
#
# Isolation: each agent runs as a distinct UID (1001+) with Landlock FS scoping
# and per-UID default-deny egress. The launcher service brokers ACP-over-TCP to
# the control-plane container (FR-025, contracts/launcher.md).

ARG RUNTIMES="opencode,pi"
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache \
      git \
      openssh-client \
      ca-certificates \
      # Landlock is kernel-native (>=5.13); we only need the libcap tooling.
      libcap \
      util-linux \
      # ip(8) for network diagnostics inside the container.
      iproute2

# ── Launcher service (ACP-over-TCP bridge + per-process sandbox) ──────────
WORKDIR /app/launcher
COPY launcher/package*.json ./
RUN npm ci --omit=dev

COPY launcher/ ./

# ── Agent runtimes ───────────────────────────────────────────────────────
# Each runtime is conditionally installed based on the RUNTIMES build arg.
# The launcher selects the correct binary when spawning agent processes.
ARG RUNTIMES
RUN set -e; \
    for rt in $(echo "$RUNTIMES" | tr ',' ' '); do \
      case "$rt" in \
        opencode) npm install -g opencode@latest ;; \
        pi)       npm install -g pi-acp@latest   ;; \
        *)        echo "Unknown runtime: $rt" >&2 ;; \
      esac; \
    done

# ── Per-agent UID range ───────────────────────────────────────────────────
# Agent slots use UIDs 10000–10999. The launcher spawns each agent as the
# next available UID in this range, enforcing UID-based isolation between
# co-resident agents.
RUN for uid in $(seq 10000 10099); do \
      adduser -D -H -u $uid agent$uid 2>/dev/null || true; \
    done

EXPOSE 7700

CMD ["node", "server.js"]
