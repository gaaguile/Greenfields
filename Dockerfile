# Greenfields in a container: the same code and config as the native Windows setup (see docs/docker.md).
FROM node:24-bookworm-slim

WORKDIR /app

# Dev dependencies stay: the app runs TypeScript with tsx, and publishing uses esbuild and wrangler.
# Optional dependencies (Playwright) are left out, so sources marked "render" fail in Docker.
COPY package.json package-lock.json ./
RUN npm ci --omit=optional && npm cache clean --force

COPY tsconfig.json ./
COPY config ./config
COPY data ./data
COPY site ./site
COPY src ./src

ENV GREENFIELDS_DATA_DIR=/data \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=8787
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
