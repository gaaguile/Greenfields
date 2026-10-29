# Running Greenfields with Docker

The main setup is native Windows (Task Scheduler, see the README). These Docker files are the alternative for
another computer: the same code and config, with Ollama and the Cloudflare Tunnel connector as sibling containers.

| Container | What it runs |
|---|---|
| `app` | `npm start`: the scheduler (03:00 and 10:00 New York time) and the review page on port 8787 |
| `ollama` | the local triage model, on the NVIDIA GPU |
| `cloudflared` | the tunnel to `greenfields-admin.gabrieltekken.com` |

## Requirements

- Docker Desktop (Windows) or Docker Engine with the Compose plugin.
- For the GPU: an NVIDIA driver and GPU support in Docker (on Windows, Docker Desktop with the WSL 2 backend).
- A filled `.env` in the repo folder (see `.env.example`), plus `CLOUDFLARED_TOKEN`.

## One-time setup

1. **Data folder.** The database lives in `./docker-data` unless you set `GREENFIELDS_DOCKER_DATA` to another
   folder. To start from the existing database, copy `D:\GreenfieldsData\greenfields.db` into that folder. Otherwise
   load the dataset:

   ```bash
   docker compose run --rm app npm run import
   docker compose run --rm app npm run sources -- sync
   ```

2. **Model.**

   ```bash
   docker compose up -d ollama
   docker compose exec ollama ollama pull llama3.1:8b
   ```

3. **Tunnel.** Follow [admin-setup.md](admin-setup.md), with two differences: on the tunnel's install page, copy only
   the token (the long string in the command) into `.env` as `CLOUDFLARED_TOKEN`, and set the route's Service URL to
   `http://app:8787` instead of `http://localhost:8787`.

## Start and stop

```bash
docker compose up -d --build
docker compose logs -f app
docker compose down
```

The review page is also at <http://127.0.0.1:8787> on that machine (only there). Logs are in the data folder under
`logs/`.

## Check the image builds and answers (spec §11)

This builds the app image and starts it alone on a scratch folder, with the login check off, then asks its health
endpoint:

```bash
docker compose build app
docker compose run --rm -d --name gf-check -p 127.0.0.1:8788:8787 -e GREENFIELDS_ADMIN_DEV=1 -v "%TEMP%\gf-check:/data" app
curl http://127.0.0.1:8788/healthz
docker stop gf-check
```

`curl` should print `ok`. (In PowerShell use `-v "$env:TEMP\gf-check:/data"` instead.)

## Differences from the native setup

- **No Chromium in the image**, so the sources marked `"render": true` (Barrick, Newmont) fail their checks and
  show as unhealthy.
- **No GPU guard reading**: `nvidia-smi` is not in the app container, so triage is never postponed for games.
- Restarts are handled by Docker (`restart: unless-stopped`) instead of Task Scheduler.
