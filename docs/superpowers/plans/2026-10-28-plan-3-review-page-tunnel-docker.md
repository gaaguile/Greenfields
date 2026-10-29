# Greenfields Plan 3 — Review Page, Tunnel and Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a private web page at `greenfields-admin.gabrieltekken.com` to approve, edit or reject held changes, edit projects and sources, see and revert the change log, and check runs and source health, with "Run now" and "Publish now" buttons. It sits behind Cloudflare Tunnel and Access. Also add a tested Docker alternative to the native Windows setup.

**Architecture:** The review page is served by the same long-running Node process as the scheduler (`npm start`). It uses Hono with server-rendered HTML and a little inline JS. It listens on `127.0.0.1:8787` only, and every request except `/healthz` must carry a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) for the owner's email. All database changes go through new store functions in `src/store/review.ts`, which keep the history append-only: approving, editing and reverting insert or publish `field_values` rows, decided by `owner`. Owner-approved changes reach the public site with "Publish now" or at the next run. `cloudflared` runs as a Windows service. The Docker files run the same code with Ollama and cloudflared as sibling containers.

**Tech Stack:** Node 24, TypeScript, Hono (`hono`, `@hono/node-server`), `jose` (JWT and JWKS), Vitest (`app.request()`, so no network), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-28-greenfields-design.md`. This plan implements:
- §8 Review page: tabs 1, 3, 4 and 5, plus the security rules
- the Docker part of §3 ("Alternative deployment")
- the tunnel and Access parts of §10, and the Docker check in §11

Tab 2 (Suggested projects) moves to Plan 4 with discovery, because nothing creates suggestions before then.

## Global Constraints

- Everything from Plans 1 and 2 still applies: Node ≥ 24 with `node:sqlite`, strict TypeScript ESM, ISO-8601 UTC timestamps, the DB outside the repo, and the `projects.json` publish flow.
- **Listening:** `127.0.0.1:8787` by default. `ADMIN_HOST` and `ADMIN_PORT` in the environment override it (Docker uses `0.0.0.0` inside the container and publishes the port to `127.0.0.1` only).
- **Authentication on every route except `GET /healthz`:**
  - verify `Cf-Access-Jwt-Assertion` with RS256 against `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`
  - `aud` must contain `CF_ACCESS_AUD`, `iss` must be `https://<CF_ACCESS_TEAM_DOMAIN>`, `exp` must be in the future
  - the token's `email` must equal `ADMIN_EMAIL` (case-insensitive)
  - any failure gives `403` with a short plain-text reason, never the page
  - if `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` or `ADMIN_EMAIL` is missing, every route except `/healthz` gives `503 Access is not configured`
  - `GREENFIELDS_ADMIN_DEV=1` skips the JWT check for trying the page locally; the app logs a warning at startup when it is set
- **Changes need a same-origin POST:** every action is a `POST` form. A POST whose `Origin` header (or `Sec-Fetch-Site`) shows another site gets `403`. No action is reachable with `GET`.
- **Escaping:** every value that came from a document, a model or the owner (titles, quotes, values, URLs, errors) is HTML-escaped. Links are rendered only for `http(s)` URLs. Use Hono's `html` tagged template, which escapes interpolations, and never `raw()` on data.
- **History stays append-only:** no `UPDATE` changes `value_text` of an existing `field_values` row. "Edit and approve" inserts a new row; "Revert" inserts a copy of the older value and publishes it. All owner decisions have `decided_by = 'owner'`.
- **Stage, owners and minerals** live on the `projects` row. Approving one of these updates that row as well as publishing the `field_values` row. Stage text goes through `normalizeStage`, and minerals through `mineralSymbol`.
- **One run at a time:** "Run now" and "Publish now" use the Plan 2 run lock. If a run is in progress, the page says so instead of starting another.
- **Secrets** (in `.env` only): `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAIL`, and for Docker `CLOUDFLARED_TOKEN`. Added to `.env.example` with empty values.
- **English only**, same look as the public site (system fonts, the copper accent, light and dark).
- Tests never touch the network: JWTs are signed with a key pair made in the test, and the JWKS is passed in.

## Review Focus

1. **A forged or replayed token:** a missing header, the wrong `aud`, an expired token, an `alg: none` token, a token signed by another key, or a valid token for another email must all give `403`. Tests are in Task 1.
2. **Script in scraped content:** a document title, quote or error containing `<script>` or `"><img onerror=…>` must appear as text on every tab. A `javascript:` source URL must not become a link. Tests are in Tasks 3–5.
3. **Cross-site form posts:** a POST with `Origin: https://evil.example` must be refused even with a valid token (Access cookies travel with cross-site requests). Test in Task 2.
4. **Approving a stage change** must update the project's stage, stalled flag and stage text, so the public table shows it after publishing. Approving an old pending value after a newer one was published must not silently hide the newer one: the page warns that the value would replace a newer published value. Tests are in Task 3.
5. **"Run now" twice, or while the 10:00 run is going,** must start one run only and tell the owner. Test in Task 6.

---

### Task 1: Access check, server shell and `/healthz`

**Files:**
- Create: `src/admin/access.ts`, `src/admin/app.ts`, `src/admin/layout.ts`
- Modify: `package.json` (dependencies `hono`, `@hono/node-server`, `jose`), `src/config.ts`, `config/default.json`, `.env.example`
- Test: `tests/admin/access.test.ts`, `tests/admin/helpers.ts`

**Interfaces:**
- Produces:
  - `AppConfig` gains `admin: { host: string; port: number }` (defaults `127.0.0.1` and `8787`, overridden by `ADMIN_HOST`/`ADMIN_PORT`)
  - `AccessSettings = { teamDomain: string; aud: string; email: string } | { dev: true } | null` from `accessSettings(env): AccessSettings`
  - `accessMiddleware(settings: AccessSettings, jwks: JWTVerifyGetKey): MiddlewareHandler`, which sets `c.var.ownerEmail`
  - `createAdminApp(deps: AdminDeps): Hono`, where `AdminDeps = { db: DatabaseSync; cfg: AppConfig; access: AccessSettings; jwks: JWTVerifyGetKey; actions: AdminActions; now: () => Date }`
  - `AdminActions = { runNow(): { started: boolean; reason?: string }; publishNow(): Promise<{ deployed: boolean } | { busy: true }> }`
  - `page(title: string, active: TabKey, body: HtmlEscapedString): HtmlEscapedString` renders the tab bar (Pending changes, Projects & sources, Change log, Runs & health)
  - `tests/admin/helpers.ts`: `testKeys()` returns `{ jwks, sign(claims, opts?) }`, plus `adminApp(over?)` building an app on an in-memory DB with the Plan 1 fixture

- [ ] **Step 1: Write the failing tests** (`access.test.ts`):
  - `GET /healthz` gives 200 `ok` with no token.
  - **Allowed:** a valid token (right `iss`, `aud`, `email`, `exp`) gives 200 on `GET /`.
  - **Refused with 403:**
    - no header
    - wrong `aud`
    - expired token
    - another email
    - a token signed by a second key pair
    - an unsigned `alg: none` token built by hand
  - **Email case:** the email matches case-insensitively.
  - **Not configured:** with `access: null`, `GET /` gives 503 `Access is not configured` and `/healthz` still gives 200.
  - **Dev mode:** with `{ dev: true }`, `GET /` gives 200 with no token.
  - **Config:** `loadConfig({ ADMIN_PORT: "9000" }).admin.port` is `9000`.
- [ ] **Step 2: Run** `npx vitest run tests/admin`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - Use `jose.jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] })`. The production JWKS is `createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))`, built once in `start.ts` (Task 6).
  - `GET /` redirects to `/pending`.
  - The layout's CSS is inline in a `<style>` block, copying the public site's colour tokens.
- [ ] **Step 4: Run again, then `npm test` and `npm run typecheck`.** Expected: PASS. Commit: `feat(admin): Access-protected server shell and health check`.

### Task 2: Runs and health tab, same-origin POST rule

**Files:**
- Create: `src/admin/tabs/health.ts`, `src/admin/forms.ts`
- Modify: `src/admin/app.ts`, `src/pipeline/run.ts` (store quota time)
- Test: `tests/admin/health.test.ts`

**Interfaces:**
- Consumes: `lastRunStartedAt`, `listSources`, `listDocumentsByStatus`, `nextSlot` (Plan 2)
- Produces:
  - `GET /health` renders:
    - the last 10 runs: start, trigger, duration, counts, errors and postponed
    - the next run time in New York time
    - sources whose health is not `ok`
    - documents failed in the last 7 days, with their error
    - the Workers AI quota line: "last ran out at …" from `meta.quota_exhausted_at`, or "no quota problems"
    - **Run now** and **Publish now** buttons
  - `POST /health/run` calls `actions.runNow()` and `POST /health/publish` calls `actions.publishNow()`. Each redirects to `/health` with a one-line notice, passed in the query string (`?notice=`) and escaped when shown.
  - `sameOriginOnly(): MiddlewareHandler` for every POST: refuse with 403 when `Sec-Fetch-Site` is present and not `same-origin`, or when `Origin` is present and its host differs from the request's `Host`.
  - The extract stage stores `meta.quota_exhausted_at` (ISO time) when it catches `QuotaExceededError`.

- [ ] **Step 1: Write the failing tests.**
  - With two finished runs, a run with `errors: ["publish: wrangler exited with code 1"]`, an unhealthy source and a failed document, `GET /health` shows each of them.
  - A failed document whose error is `<script>alert(1)</script>` appears escaped (`&lt;script&gt;`).
  - `POST /health/run` with `Origin: https://evil.example` gives 403 and does not call `runNow`.
  - The same POST with the app's own origin calls `runNow` once and redirects (303) to `/health`.
  - A busy `publishNow` result shows "A run is in progress; it will publish when it finishes."
  - A run test in `tests/pipeline/run.test.ts`: the quota case stores `quota_exhausted_at`.
- [ ] **Step 2: Run** `npx vitest run tests/admin/health.test.ts tests/pipeline/run.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Dates are shown in New York time with the same formatter as the public site.
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(admin): runs and health tab with Run now and Publish now`.

### Task 3: Pending changes tab

**Files:**
- Create: `src/store/review.ts`, `src/admin/tabs/pending.ts`
- Modify: `src/admin/app.ts`
- Test: `tests/store/review.test.ts`, `tests/admin/pending.test.ts`

**Interfaces:**
- Consumes: `publishFieldValue`, `insertFieldValue`, `getPublished` (Plan 1), `normalizeStage`, `mineralSymbol`
- Produces, in `src/store/review.ts`:
  - `PendingItem = { id; projectId; projectName; projectSlug; field; label; proposed: string; current: string | null; currentDecidedAt: string | null; holdReason: string | null; quote: string | null; confidence: number | null; figureDate: string | null; documentUrl: string | null; documentTitle: string | null; createdAt: string; newerPublished: boolean }`
  - `listPending(db): PendingItem[]`, oldest first and grouped by project. `newerPublished` is true when the published value was decided after this item was created.
  - `approvePending(db, id, at): void` publishes the row as `owner`. For `stage`, `owners` or `minerals` it also updates the project row: `stage`, `stalled` and `stage_text` from `normalizeStage`; `owners` as the text; `minerals` as the JSON list of symbols; and `updated_at`.
  - `editAndApprove(db, id, edit: { valueText: string; valueNum: number | null }, at): number` inserts a new row copying the pending row's source, quote and basis with the edited value, publishes it as `owner`, and marks the original `rejected`. Returns the new id.
  - `rejectPending(db, id, at): void` sets `status = 'rejected'`, `decided_by = 'owner'` and `decided_at`.
  - Each of these throws `not pending` for a row whose status is not `pending`.
- Produces, in the page:
  - `GET /pending` lists the items. Each shows the project, field, current → proposed, the reason held, the quote, confidence, figure date and source link, plus Approve, Edit, Reject and a checkbox.
  - An item with `newerPublished` shows the warning "A newer value was published since this was held."
  - `POST /pending/:id/approve`, `POST /pending/:id/reject`, and `POST /pending/:id/edit` (fields `valueText`, `valueNum`)
  - `POST /pending/bulk` with `action=approve|reject` and `ids` as repeated fields
  - After any action, a notice reminds the owner that changes go live with Publish now or the next run.

- [ ] **Step 1: Write the failing tests.**
  - **Store** (`review.test.ts`):
    - approving a capex pending row supersedes the old published row
    - approving `stage` "Feasibility study" sets the project's `stage` to `fs`, `stage_text` to the text and `stalled` to false, and `buildPublicData` then shows `FS`
    - approving `minerals` "Copper, Gold" stores `["Cu","Au"]`
    - edit-and-approve leaves the original row's `value_text` unchanged, marks it `rejected`, and publishes a new row with the edited value and the original's `document_id` and quote
    - reject keeps the published value
    - acting twice on the same id throws `not pending`
    - `newerPublished` is set when the published value was decided after the pending row was created
  - **Page** (`pending.test.ts`):
    - a pending item whose quote is `"><img src=x onerror=alert(1)>` and whose document URL is `javascript:alert(1)` shows the quote escaped and the URL as plain text, not a link
    - approve via POST changes the store and redirects to `/pending`
    - bulk approve of two ids publishes both
    - a GET to `/pending/1/approve` gives 404 (actions are POST only)
- [ ] **Step 2: Run** `npx vitest run tests/store/review.test.ts tests/admin/pending.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each store function runs in a transaction (the savepoint in `publishFieldValue` nests inside it). `valueNum` from the form is parsed with `Number`, and an empty value becomes `null`.
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(admin): pending changes tab with approve, edit and reject`.

### Task 4: Change log tab and revert

**Files:**
- Create: `src/admin/tabs/changes.ts`
- Modify: `src/store/review.ts`, `src/admin/app.ts`
- Test: `tests/store/review.test.ts`, `tests/admin/changes.test.ts`

**Interfaces:**
- Produces:
  - `ChangeItem = { id; projectName; field; label; oldValue: string | null; newValue: string; decidedBy: "auto" | "owner"; decidedAt: string; documentUrl: string | null; revertible: boolean }`
  - `listChanges(db, { limit: number; offset: number }): ChangeItem[]` covers published and superseded rows, newest decision first, each paired with the value it replaced. `revertible` is true only for a row that is currently published and has an older value.
  - `revertChange(db, id, at): number` inserts a copy of the previous value (same source, quote and basis) and publishes it as `owner`. It throws `not the current value` when the row is no longer the published one. For stage, owners and minerals it updates the project row as approval does.
  - `GET /changes?page=N` shows 50 per page. `POST /changes/:id/revert`.

- [ ] **Step 1: Write the failing tests.**
  - **Store:**
    - after an auto change from US$2.4 to US$2.7 billion, `listChanges` shows old and new
    - revert publishes a new row with US$2.4 billion decided by `owner`, and the row it reverted becomes `superseded`
    - reverting a row that is no longer current throws
    - the history has one more row and no row's `value_text` changed
  - **Page:**
    - a revert POST redirects and the tab shows the reverted change at the top
    - a source URL `javascript:x` is not a link
    - only the current row has a Revert button
- [ ] **Step 2: Run** `npx vitest run tests/store/review.test.ts tests/admin/changes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(admin): change log with revert`.

### Task 5: Projects and sources tab

**Files:**
- Create: `src/admin/tabs/projects.ts`
- Modify: `src/store/review.ts`, `src/store/sources.ts`, `src/admin/app.ts`
- Test: `tests/store/review.test.ts`, `tests/store/sources.test.ts`, `tests/admin/projects.test.ts`

**Interfaces:**
- Produces:
  - `updateProjectDetails(db, projectId, d: { name; aliases: string[]; region; province: string | null; locationDetail: string | null; tracking: "active" | "paused" }, at): void` changes only these columns and `updated_at`.
  - `setFigureByOwner(db, projectId, field: FieldKey | "stage" | "owners" | "minerals", valueText: string, valueNum: number | null, at): number` inserts a row and publishes it as `owner`, with no document and no quote. It updates the project row for stage, owners and minerals. Use it for hand edits, including Additional info.
  - `updateSource(db, id, s: { url; kind; projectId: number | null; company: string | null; render: boolean }): void`, and `deleteSource(db, id): void`, which keeps its documents and sets their `source_id` to NULL.
  - Pages:
    - `GET /projects` lists every project, with tracking state and a count of sources
    - `GET /projects/:slug` shows the project details form, each published figure with an edit box, the project's sources, and an "add source" form
    - `GET /sources` lists all sources, with company-wide ones at the top
  - Routes:
    - `POST /projects/:slug`, `POST /projects/:slug/figure`
    - `POST /sources`, `POST /sources/:id`, `POST /sources/:id/delete`
- [ ] **Step 1: Write the failing tests.**
  - **Store:**
    - pausing a project removes it from `buildPublicData` and from `listSources({ activeOnly: true })`
    - `setFigureByOwner("additional_info", …)` supersedes the old one and shows in `buildPublicData`
    - `setFigureByOwner("owners", "Teck 50% / Newmont 50%")` updates `projects.owners`
    - aliases round-trip as a JSON list
    - deleting a source keeps its documents
  - **Page:**
    - a project whose name was edited to `<b>x</b>` shows `&lt;b&gt;x&lt;/b&gt;`
    - adding a source with a `javascript:` URL is refused with 400 "URL must start with http:// or https://"
    - editing a figure via POST publishes it as `owner`
- [ ] **Step 2: Run** `npx vitest run tests/store tests/admin/projects.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(admin): projects and sources editing`.

### Task 6: Serve the page from the daemon

**Files:**
- Modify: `src/schedule/daemon.ts`, `src/cli/start.ts`, `src/notify/digest.ts`
- Create: `src/admin/actions.ts`
- Test: `tests/schedule/daemon.test.ts`, `tests/admin/actions.test.ts`, `tests/notify/digest.test.ts`

**Interfaces:**
- Produces:
  - `startDaemon` returns `{ stop(): void; runNow(): { started: boolean; reason?: string } }`. `runNow` starts a `manual` run through the same `runOnce` path, unless one is already running (then `{ started: false, reason: "a run is already in progress" }`).
  - `makeAdminActions(deps: { daemon; db; cfg; deploy: Deployer }): AdminActions`. `publishNow` takes the run lock, calls `publish`, releases the lock, and returns `{ busy: true }` when the lock is held.
  - `start.ts`:
    - reads the access settings
    - builds the remote JWKS once
    - creates the admin app and serves it with `@hono/node-server` on `cfg.admin.host:port`
    - logs `admin page listening` (or the Access warning)
    - closes the server on shutdown
  - The digest text ends with `Review: https://greenfields-admin.gabrieltekken.com/pending` when it has pending items.
- [ ] **Step 1: Write the failing tests.**
  - **Daemon:** `runNow` while the catch-up is running returns `started: false`, and after the run finishes `runNow` starts a manual run (fake run and timers, as in Plan 2's tests).
  - **Actions:**
    - with the run lock held by `process.ppid`, `publishNow` returns `{ busy: true }` and does not deploy
    - with no lock it deploys once and releases the lock
  - **Digest:** the review link appears with a pending item, and does not appear when only a source problem is reported.
- [ ] **Step 2: Run** `npx vitest run tests/schedule tests/admin/actions.test.ts tests/notify`. Expected: FAIL.
- [ ] **Step 3: Implement**, then smoke-test on a scratch data dir:
  - start `GREENFIELDS_ADMIN_DEV=1 GREENFIELDS_DATA_DIR=<short temp dir> npm start` for 15 s
  - `curl http://127.0.0.1:8787/healthz` returns `ok`
  - `curl http://127.0.0.1:8787/pending` returns the page
  - also check that the server does not answer on the machine's LAN address (connection refused)
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(admin): serve the review page from the daemon`.

### Task 7: Cloudflare Tunnel and Access setup (docs)

**Files:**
- Create: `docs/admin-setup.md`
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Produces: the owner's one-time steps, written for the Cloudflare dashboard as it is today. Check each step against Cloudflare's current docs before writing.
  1. **Create the tunnel:** Zero Trust › Networks › Tunnels › Create a tunnel (Cloudflared), named `greenfields-admin`.
  2. **Install the connector** on Windows with the command the dashboard shows (`cloudflared.exe service install <token>`), from an administrator PowerShell, so it runs as a Windows service.
  3. **Add the public hostname** `greenfields-admin.gabrieltekken.com` pointing to `http://localhost:8787`.
  4. **Create the Access application:** Zero Trust › Access › Applications › Add › Self-hosted, for that hostname. Use a policy that allows only the owner's email, with the one-time PIN login method.
  5. **Copy the settings into `.env`:** the application's **AUD tag** to `CF_ACCESS_AUD`, the team domain (`<team>.cloudflareaccess.com`) to `CF_ACCESS_TEAM_DOMAIN`, and the owner's email to `ADMIN_EMAIL`. Then `Restart-ScheduledTask -TaskName Greenfields`.
  6. **Check it:** open the address in a browser, log in with the emailed code, and see the Pending changes tab. In a private window without logging in, the page must not open.
- [ ] **Step 1: Write the docs** and link them from the README's commands and setup sections. Add the new names to `.env.example`.
- [ ] **Step 2: Check** every command and menu path against Cloudflare's current documentation (fetch the pages) and fix any that changed. Record the doc URLs used at the bottom of `docs/admin-setup.md`.
- [ ] **Step 3: Commit:** `docs: Cloudflare Tunnel and Access setup for the review page`.

### Task 8: Docker alternative

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docs/docker.md`
- Modify: `src/config.ts` (`OLLAMA_BASE_URL` overrides the `ollama` provider's `baseUrl`), `README.md`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  - **`Dockerfile`:**
    - based on `node:24-bookworm-slim`
    - runs `npm ci --omit=optional`, copies the source, sets `GREENFIELDS_DATA_DIR=/data`, `ADMIN_HOST=0.0.0.0` and `EXPOSE 8787`
    - starts with `CMD ["npm", "start"]`
    - has a `HEALTHCHECK` using `node -e` to fetch `http://127.0.0.1:8787/healthz`
    - Playwright is not installed, so render sources show as failing there (stated in `docs/docker.md`)
  - **`docker-compose.yml`:**
    - `app` (build `.`, `env_file: .env`, volume `${GREENFIELDS_DATA_DIR:-./docker-data}:/data`, `ports: ["127.0.0.1:8787:8787"]`, `OLLAMA_BASE_URL=http://ollama:11434`, `restart: unless-stopped`)
    - `ollama` (`ollama/ollama`, a named volume for models, NVIDIA GPU reservation through `deploy.resources.reservations.devices`)
    - `cloudflared` (`cloudflare/cloudflared`, `command: tunnel --no-autoupdate run`, `TUNNEL_TOKEN=${CLOUDFLARED_TOKEN}`), whose tunnel hostname points to `http://app:8787`
  - **`.dockerignore`:** `node_modules`, `dist`, `.env`, `.git`, `.superpowers`, `tests/fixtures`
- [ ] **Step 1: Write the failing test.** `loadConfig({ OLLAMA_BASE_URL: "http://ollama:11434" }).pipeline.providers.ollama.baseUrl` is `http://ollama:11434`.
- [ ] **Step 2: Run** `npx vitest run tests/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the override, then the Docker files.
- [ ] **Step 4: Docker check (spec §11).**
  - With Docker Desktop running, run `docker compose build app`.
  - Then start the app on a scratch data folder, in dev mode and without ollama or cloudflared: `docker compose run --rm -p 127.0.0.1:8788:8787 -e GREENFIELDS_ADMIN_DEV=1 -e GREENFIELDS_DATA_DIR=/data app` with the volume pointed at a temp folder.
  - Check that `curl http://127.0.0.1:8788/healthz` returns `ok`, then stop it.
  - If Docker Desktop is not running, record that as a ruling and leave the check for the owner in `docs/docker.md`.
- [ ] **Step 5: Run `npm test`.** Commit: `feat(docker): Dockerfile and compose stack as an alternative deployment`.

---

## After the plan (owner steps, not tasks)

1. Follow `docs/admin-setup.md`: create the tunnel and the Access application, then fill `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `ADMIN_EMAIL` in `.env`.
2. `Restart-ScheduledTask -TaskName Greenfields`, then open `https://greenfields-admin.gabrieltekken.com`.
3. Optional: try the Docker stack on another machine with `docs/docker.md`.
