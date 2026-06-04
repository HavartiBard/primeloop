**Fixing path typo**

<tool_call>
<function=bash>
<parameter=command>
cat > /home/james/projects/primeloop/.claude/worktrees/024-managed-agent-runtime/scripts/setup.sh << 'SCRIPT_EOF'
#!/bin/bash
# setup.sh - Generate docker-compose for primary + runtime container
# Usage: ./setup.sh --runtimes opencode,pi

set -e

RUNTIMES="opencode,pi"  # default

while [[ $# -gt 0 ]]; do
  case $1 in
    --runtimes)
      RUNTIMES="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Generate docker-compose.yml
cat > docker-compose.runtime.yml << EOF
version: '3.8'

services:
  primeloop-runtime:
    build:
      context: .
      dockerfile: runtime-image/Dockerfile
    image: primeloop-runtime:${RUNTIMES//,/|}
    networks:
      - primeloop-private
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    security_opt:
      - no_new_privs:true
    read_only: true
    tmpfs:
      - /tmp:size=64M
    volumes:
      - primeloop-runtime-data:/data
    restart: unless-stopped

networks:
  primeloop-private:
    driver: bridge
    internal: true

volumes:
  primeloop-runtime-data:

# To use, run:
# docker compose -f docker-compose.yml -f docker-compose.runtime.yml up -d
SCRIPT_EOF

chmod +x /home/james/projects/primeloop/.claude/worktrees/024-managed-agent-runtime/scripts/setup.sh
echo "Generated scripts/setup.sh with runtimes: $RUNTIMES"