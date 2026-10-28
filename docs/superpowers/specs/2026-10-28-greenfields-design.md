# Greenfields — Design Spec

- **Date:** 2026-10-28
- **Status:** Draft for review
- **Repo:** `C:\Repo\Greenfields` (remote `github.com/gaaguile/Greenfields`)

## 1. Purpose

A public website that shows an up-to-date table of **greenfield metal projects in Chile** (Cu, Au, Ag, Mo and others). The data is kept current by an automated pipeline on the owner's home server. The pipeline reads company investor-relations (IR) pages and other public sources twice a day, extracts the latest figures with AI models, and publishes them.

Early-stage projects mostly announce news on IR websites. Tracking those by hand is slow and easy to miss. This system watches the sources, pulls out what changed, and keeps the public table current with minimal manual work.

### Users

- **Owner (single editor):** reviews held changes and suggested new projects, and manages sources.
- **Public visitors (read-only):** browse, filter and export the table.

### Success criteria

- The public table shows every tracked project with its key figures. Each figure links to the source document and the exact quote it came from.
- New IR disclosures for tracked projects show up on the site within one run (≤ ~17 h) without manual work, unless a rule holds them for review.
- Possible new projects appear in the review page as suggestions. None is published without owner approval.
- No figure is published unless its quote is found in the source document.
- The system runs unattended on the home server and recovers from reboots, crashes and unreachable sites.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Audience | Owner edits; public read-only website |
| "Update" meaning | Latest available information per project (not an event timeline); history kept internally |
| Update mode | Mostly automatic (auto-publish confident routine changes; hold the rest) |
| Project list | Owner's dataset + **automatic discovery** of new projects, approved by the owner |
| Greenfield definition | New deposits with **no operating mine on site**, from early exploration onwards. Brownfield expansions excluded. |
| Language | **TypeScript** for all code; public site in **English only** |
| Hosting | Home server does all the work; Cloudflare hosts the public static site only |
| Server | Main home server: Windows 11, RTX 4060 Ti **8 GB**, always on. Second server not used. |
| Runtime | **Native Windows** (no Docker in production). Docker files kept and tested as an alternative deployment. |
| Data store | **SQLite** on the home server, **outside** the repo and outside OneDrive (`C:\GreenfieldsData\greenfields.db`) |
| Publishing | Push: server deploys `projects.json` + static site to **Cloudflare Pages** after each run if anything changed |
| Schedule | **03:00 and 10:00 `America/New_York`** |
| AI | Local **Ollama** (8B-class model) for triage; **Workers AI** for extraction; **Claude** available as a config switch |
| Review page | On the home server, exposed via **Cloudflare Tunnel + Access** |
| Domain | `gabrieltekken.com` — public `greenfields.gabrieltekken.com`, admin `greenfields-admin.gabrieltekken.com` |
| Notifications | Daily email via **Gmail app password**, only when items are pending |
| Backups | **None for now** (code is on GitHub; DB not backed up) |
| Table extra info | Fixed columns + free-text **"Additional info"** column |
| Figure basis | Table shows **100% basis**; attributable share in detail view |

## 3. Architecture

```
HOME SERVER (Windows 11, RTX 4060 Ti) — always on
┌───────────────────────────────────────────────────────────┐
│ Greenfields app (TypeScript / Node, one process)           │
│  ├─ Scheduler ─── 03:00 & 10:00 NY, catch-up, gaming guard │
│  ├─ Watcher ───── checks IR pages, SEIA, news for new docs │
│  ├─ Reader ────── HTML/PDF → text (Playwright if needed)   │
│  ├─ Triage ────── Ollama 8B on GPU: relevant? material?    │
│  ├─ Extractor ─── Workers AI (Claude later): figures+quote │
│  ├─ Verifier ──── quote must exist in the document         │
│  ├─ Rules ─────── auto-publish vs hold for review          │
│  ├─ Store ─────── SQLite: projects, values, sources, log   │
│  ├─ Review page ─ web UI (Hono), 127.0.0.1 only            │
│  ├─ Publisher ─── projects.json + site → Cloudflare Pages  │
│  └─ Notifier ──── Gmail SMTP daily digest                  │
│ Ollama (Windows service)    cloudflared (Windows service)  │
└──────────────┬──────────────────────────────┬─────────────┘
               │ deploy (outbound)            │ tunnel (outbound)
               ▼                              ▼
     Cloudflare Pages                 Cloudflare Access
     greenfields.gabrieltekken.com    greenfields-admin.gabrieltekken.com
```

- **One TypeScript codebase.** Each module has one job and a typed interface, and can be tested on its own.
- **One long-running Node process.** It is started at boot by **Windows Task Scheduler**, restarts on failure, and runs its own internal scheduler. It stays running because the review page must answer at any time. Between runs it is idle (~100 MB RAM, ~0% CPU).
- **Ollama** and **cloudflared** run as separate Windows services.
- **No inbound ports** are opened on the home network. All connections are outbound.
- **AI providers sit behind one `ModelProvider` interface** (OpenAI-compatible chat API), with implementations for Ollama, Workers AI and Claude. Which provider handles triage and which handles extraction is configuration.
- **Initial data:** `data/chile_greenfield_projects.json` is imported once into SQLite by an import script.

### Alternative deployment (Docker)

The repo contains a `Dockerfile` and `docker-compose.yml` (app + Ollama with NVIDIA GPU + cloudflared). The same code and config run in either mode. The Docker setup is built and started once as part of testing, so it stays valid.

## 4. Data model (SQLite)

Every figure is stored with its source. No bare numbers.

| Table | Contents |
|---|---|
| `projects` | id, slug, name, aliases (e.g. Norte Abierto), owners (text), minerals (list), region, province, location detail, optional lat/lon, `stage` (category), `stage_text` (original wording), `stalled` flag, tracking status (`active` / `paused`), created/updated timestamps |
| `field_values` | One row per figure per version: project, field key, value text, optional numeric value + unit, basis (`100%` / `attributable`), attributable share, figure date, source document id, exact quote, confidence (0–1), status (`published` / `pending` / `rejected` / `superseded`), decided by (`auto` / `owner`), timestamps |
| `sources` | Watched page URL, kind (`ir_news`, `seia`, `cochilco`, `news_feed`, `newswire`), linked project or company, last checked, content fingerprint, consecutive failure count, health status |
| `documents` | URL, source id, title, publication date, content fingerprint, extracted text, triage result (project, category, material?, candidate?), processing status (`found` / `read` / `triaged` / `extracted` / `done` / `failed`), error |
| `suggestions` | Candidate project: extracted fields, supporting document ids, possible duplicate project id, status (`pending` / `approved` / `merged` / `rejected`) |
| `runs` | Start/end, trigger (`schedule` / `manual` / `catch-up`), counts, errors, postponed-by-gaming-guard flag, published? |

**Field keys (v1):** `capex_usd`, `mine_life_years`, `resource_headline`, `reserve_headline`, `annual_production`, `grade`, `c1_cost`, `throughput_tpd`, `additional_info`, plus `owners`, `stage` and `minerals` changes. Further keys can be added without schema changes.

**Stage categories:** Exploration → Advanced exploration → Scoping/PEA → PFS → FS → Permitting (EIA/SEIA) → Construction decision, plus a separate `stalled` flag.

**Change history:** no separate table. It is the sequence of `field_values` versions. Publishing a new value sets the old one to `superseded`, which also makes revert possible.

**Public output:** `projects.json` contains only `published` values: one entry per project with table fields, detail figures (date, basis, source URL, quote) and the last N changes. Pending, rejected and internal data never leave the server.

## 5. Update pipeline (each run)

1. **Start:** scheduled (03:00 / 10:00 NY), manual ("Run now") or catch-up (a missed run is detected at startup and run straight away).
2. **Watch:** fetch each active source politely: limited concurrency, delays between requests, robots.txt respected, identifying user agent. Unchanged fingerprints are skipped. Changed pages are parsed for links to new documents.
3. **Read:** download new documents and convert them to text. HTML and PDF are handled directly; **Playwright** is used for JavaScript-rendered pages.
4. **Triage (Ollama, local GPU):** for each document, decide which tracked project it concerns, a category (study, resource, drilling, permit, ownership, financing, routine), whether it is material, and whether it is a possible new project. Routine documents stop here. Possible new projects go to discovery (§6).
5. **Extract (Workers AI):** the model gets the project's current published record and the document text. It returns structured JSON of proposed figures, each with value, unit, basis, figure date, confidence and **exact quote**. The output is checked against a schema; invalid output is retried once.
6. **Verify:** each quote must appear in the document text (normalized for whitespace and case). Figures that fail are dropped and logged.
7. **Rules:** compare each figure with the current published value.
   - **Auto-publish:** confidence ≥ threshold, and either a new field or a small change to a numeric value, from a material document.
   - **Hold for review:** stage changes, owner changes, numeric changes beyond the threshold (default ±20%), conflicting sources in the same run, or low confidence.
   - Thresholds are settings.
8. **Publish:** if published data changed, build `projects.json`, then deploy it with the static site to Cloudflare Pages through the Pages Direct Upload API.
9. **Notify:** after the 10:00 run, if pending items or suggestions exist, send one digest email (at most one per day).

**Gaming guard:** before triage, check GPU load (NVIDIA's `nvidia-smi`) and whether a full-screen game is running.
- If the GPU is busy, postpone triage by 30 min and retry.
- If it is still busy when the next scheduled run is due, triage goes to Workers AI for that run.
- Ollama's `keep_alive` is set to ~30 s so video memory is freed straight after use.

**Workers AI quota:** if the free daily quota runs out, the remaining documents stay at status `triaged` and are processed in the next run.

## 6. Discovery (new projects)

- **Sources:** SEIA new submissions (DIA/EIA, mining sector), Cochilco investment reports, free mining news feeds (e.g. Minería Chilena, Reporte Minero, Mining.com), and newswire press releases that mention Chile. The final list is set during implementation, after checking each site's structure and terms of use.
- **Flow:**
  1. Triage flags a possible new project.
  2. Extraction pulls out name, company, minerals, region, stage and source.
  3. A duplicate check runs against existing projects and their aliases, and against rejected suggestions (similar names + same owner + same region).
  4. The result becomes a suggestion in the review page.
- **Rules:**
  - Only greenfield candidates (§2 definition) are suggested.
  - Discovery **never publishes** anything by itself.
  - When the owner approves a suggestion, the project is created and the system proposes the company's IR news page as a source for the owner to confirm.
  - Rejected suggestions are remembered and not suggested again.

## 7. Public site (`greenfields.gabrieltekken.com`)

- A static site on Cloudflare Pages: TypeScript compiled to plain JS, no framework. It loads `projects.json` at page load.
- **Columns:** Project · Owner(s) · Minerals · Region · Stage · Capex (US$) · Mine life · Resource/reserve headline · Additional info · Last updated · Source.
- **Features:**
  - sort on any column
  - filters for mineral, region and stage
  - "hide early exploration" toggle
  - text search over name, owner and additional info
  - "updated" badge for changes in the last 7 days
  - missing values shown as "—"
  - CSV export of the filtered rows
- **Detail view (click a row):** every figure with date, basis, attributable share where known, source link and quote; recent changes.
- **Header and footer:** time of the last data update (NY time), a methodology note (sources; figures partly auto-extracted; check the source), and a "not investment advice" disclaimer.
- **Mobile:** the table scrolls sideways with the project name fixed on the left; filters fold into a panel.
- **Analytics:** optional Cloudflare Web Analytics (no cookies).

## 8. Review page (`greenfields-admin.gabrieltekken.com`)

Served by the Node app (Hono, server-rendered HTML with a little JS), reading and writing the same SQLite file.

**Tabs:**
1. **Pending changes:** current → proposed value, source document, quote, why it was held. Actions: Approve, Edit and approve, Reject. Several items can be approved at once.
2. **Suggested projects:** extracted details, sources, duplicate warning. Actions: Approve, Merge into existing project, Reject.
3. **Projects and sources:** edit any project by hand (including additional info), manage watched URLs and aliases, pause tracking.
4. **Change log:** all published changes (auto or owner), with old and new values and the source. Action: Revert.
5. **Runs and health:** last and next run, counts, errors, unhealthy sources, quota status. Actions: Run now, Publish now.

**Security:**
- Cloudflare Access only lets the owner's email address in (one-time code login).
- The app only listens on `127.0.0.1`.
- The app checks the `Cf-Access-Jwt-Assertion` token on every request.
- Owner actions are recorded in the history as `owner`.

**Publishing owner actions:** approved changes are published with "Publish now" or at the next run.

## 9. Error handling

| Problem | Behaviour |
|---|---|
| Source unreachable or blocking | Retry with backoff within the run. After 3 failed runs in a row, mark the source unhealthy and show it in Tab 5 and the email. |
| Source structure changed (no links parsed) | Flag "source may have changed" |
| GPU busy | Gaming guard (§5) |
| Workers AI quota or errors | Carry the documents over to the next run |
| Invalid model output | Retry once, then mark the document `failed` and list it in Tab 5 |
| Quote not found | Drop the figure and log it |
| Publish fails | Site keeps its last version; retry next run; shown in Tab 5 |
| Crash or reboot | Task Scheduler restarts the app; document statuses let the run resume; missed runs are caught up |

## 10. Operations

- **Secrets** go in a `.env` file that git ignores:
  - Cloudflare API token (Pages edit + Workers AI)
  - Cloudflare account ID
  - Access audience tag
  - Gmail address + app password
  - optional Anthropic API key
- **Config** (schedule, thresholds, providers, models, paths) lives in a versioned config file. Paths and secrets are kept separate from config.
- **Logs:** daily rotating files under `C:\GreenfieldsData\logs`.
- **Shortcuts:** `npm run db:show -- <table>` prints a table in the terminal; `npm run import` loads the initial JSON.
- **README:** setup for Node, Ollama + model, cloudflared tunnel + Access app, Pages project, Gmail app password, Task Scheduler entry, and the Docker alternative.
- **Backups:** none in v1.

## 11. Testing

- **Unit tests (Vitest),** run against saved copies of real IR pages, PDFs and model outputs (offline), covering:
  - HTML and PDF parsing, and link discovery
  - quote verification
  - publish/hold rules
  - duplicate matching
  - JSON building and the CSV export format
  - scheduler time-zone handling, including daylight-saving changes
- **Accuracy test set:** 10–20 real documents from tracked projects, with figures checked by hand. A script scores each provider/model on field-level precision and recall. It is used to choose the triage and extraction models and to catch regressions.
- **Dry-run mode:** the full pipeline runs against a copy of the database with no publish and no email.
- **Docker check:** the compose stack is built and started once, and the app's health endpoint responds.

## 12. Out of scope (v1)

- map view
- Spanish or other languages
- brownfield expansions
- paid data sources
- charts of figure history
- multiple editors
- Claude as the default provider (kept as a switch)
- database backups
- use of the second server

## 13. Open items for implementation

- Pick the Ollama triage model and the Workers AI extraction model using the accuracy test set.
- Finalize the discovery source list after checking each site's structure and terms of use.
- Map each tracked project to its company's IR news page during the initial import, confirmed by the owner.
