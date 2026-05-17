# ── Stage 1: build React UI ───────────────────────────────────────────────────
FROM node:22-alpine AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# ── Stage 2: build backend ────────────────────────────────────────────────────
FROM node:22-alpine AS backend-builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
RUN npm run build

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache tini git

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && \
    npm install -g @openai/codex && \
    npm install -g opencode-ai && \
    npm install -g @earendil-works/pi-coding-agent

COPY --from=backend-builder /app/dist ./dist
COPY --from=web-builder /web/dist ./public
COPY entrypoint.sh ./entrypoint.sh
COPY entrypoint-setup.sh ./entrypoint-setup.sh
RUN chmod +x ./entrypoint.sh ./entrypoint-setup.sh

ENV NODE_ENV=production
EXPOSE 3100

ENTRYPOINT ["/sbin/tini", "--", "./entrypoint-setup.sh"]
