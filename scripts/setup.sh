#!/bin/bash
# setup.sh — Generate the runtime-container compose for the selected runtimes (FR-024).
# Usage: ./setup.sh --runtimes opencode,pi
set -euo pipefail

RUNTIMES="opencode,pi"   # default

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtimes)
      RUNTIMES="${2:?--runtimes requires a value}"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      shift
      ;;
  esac
done

# Docker image tags may not contain commas/pipes — sanitize the runtime list.
TAG="${RUNTIMES//,/-}"

cat > docker-compose.runtime.yml <<EOF
services:
  primeloop-runtime:
    build:
      context: .
      dockerfile: runtime-image/Dockerfile
      args:
        RUNTIMES: "${RUNTIMES}"
    image: primeloop-runtime:${TAG}
    networks:
      - primeloop-private
    cap_add:
      - NET_ADMIN
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=64M
    restart: unless-stopped

networks:
  primeloop-private:
    driver: bridge
    internal: true
EOF

echo "Generated docker-compose.runtime.yml (runtimes: ${RUNTIMES})"
echo "Run with: docker compose -f docker-compose.yml -f docker-compose.runtime.yml up -d"
