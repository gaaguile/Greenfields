# Greenfields in a container: the same code and config as the native Windows setup (see docs/docker.md).
FROM node:24-bookworm-slim

WORKDIR /app

# All dependencies install: tsx runs the app, esbuild and wrangler publish, and their Linux binaries are
# "optional" packages, so --omit=optional would break them. Playwright's package installs too, but no browser is
# downloaded, so sources marked "render" fail in Docker.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

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
