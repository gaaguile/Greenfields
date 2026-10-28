# Greenfields Plan 2 — Update Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the public table current without manual work. Twice a day the home server checks each tracked project's IR news page, reads new documents, triages them with local Ollama, extracts figures with Workers AI, verifies every quote, and then either auto-publishes the change or holds it for review. It deploys the site when anything changed and emails a daily digest.

**Architecture:** New server modules sit next to Plan 1's `store`, `domain` and `publish`:
- `watch`: polite fetching, robots.txt and link discovery
- `read`: HTML, PDF and rendered pages converted to text
- `ai`: one `ModelProvider` interface with Ollama and OpenAI-compatible implementations
- `pipeline`: triage, extract, verify, rules and the run orchestrator
- `schedule`: slots, catch-up and the gaming guard
- `notify`: the digest email

One long-running Node process (`npm start`) owns the scheduler. Windows Task Scheduler starts it at boot and restarts it on failure. `npm run run-once` runs one run by hand, with `--dry-run` for a copy of the DB with no publish and no email. Every stage moves a document through `documents.status`, so a crash resumes where it stopped. This is Plan 2 of 4: Plan 3 adds the review page, tunnel and Docker, and Plan 4 adds discovery.

**Tech Stack:** Node 24 (`node:sqlite`, global `fetch`), TypeScript, tsx, Vitest, plus new runtime dependencies: `cheerio` (HTML), `unpdf` (PDF), `zod` (model-output schemas), `nodemailer` (Gmail SMTP), `playwright` (optional, lazily imported, only for sources marked `render`).

**Spec:** `docs/superpowers/specs/2026-10-28-greenfields-design.md`. This plan implements:
- §5 Update pipeline
- §9 Error handling
- the operations parts of §10: secrets, config, logs, Task Scheduler and README
- the unit tests and dry-run of §11, and the accuracy-test scaffold
- the source mapping in §13

Discovery (§6) is out of scope. Triage records the "possible new project" flag on the document so Plan 4 can use it.

## Global Constraints

- Everything from Plan 1's Global Constraints still applies:
  - Node ≥ 24 with `node:sqlite`
  - strict TypeScript ESM with `.ts` import extensions
  - the DB lives at `C:\GreenfieldsData\greenfields.db`, outside the repo and OneDrive
  - ISO-8601 UTC timestamps
  - `projects.json` holds published values only
- **Schedule:** `03:00` and `10:00` in `America/New_York`. Missed slots are caught up at startup.
- **Auto-publish:** confidence ≥ `0.8` (setting), from a document triaged as material, and either a field with no published value or a numeric change within **±20%** (setting) of the published number.
- **Always hold** these for review:
  - `stage`, `owners` and `minerals` changes
  - numeric changes beyond the threshold
  - text-only changes to a field that already has a value
  - two different values for the same project and field in one run
  - low confidence
- **Quote verification:** a quote must appear in the document text after normalizing whitespace and case. Figures that fail are dropped and logged, never stored.
- **Fetching:**
  - user agent `GreenfieldsBot/0.2 (+https://greenfields.gabrieltekken.com)`
  - robots.txt is respected
  - at most 2 requests in flight
  - at least 2 s between requests to the same host
  - 3 attempts with backoff within a run
- **Source health:** 3 failed runs in a row mark a source `unhealthy`. A page that loads but yields no links is marked `changed`.
- **Gaming guard:** GPU utilisation above 30% (`nvidia-smi`), or a configured game process running, postpones triage by 30 min. If the guard is still busy when the next slot is due, that run's triage goes to the fallback provider (Workers AI). Ollama calls use `keep_alive: "30s"`.
- **Workers AI quota:** when the quota runs out (HTTP 429 or error code `4006`), the remaining documents stay `triaged` for the next run. This is not a failure.
- **Model output:** invalid output is retried once. If it is still invalid, the document is marked `failed` with the error.
- **Email:** at most one digest per New York calendar day, sent after the 10:00 run, through `smtp.gmail.com:465` with an app password.
- **Secrets** are read from `.env` only: `CLOUDFLARE_API_TOKEN` (now also needs Workers AI › Read), `CLOUDFLARE_ACCOUNT_ID`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DIGEST_TO`, and optionally `ANTHROPIC_API_KEY`. `.env.example` is committed again with these names and empty values.
- **Logs:** daily files at `C:\GreenfieldsData\logs\greenfields-YYYY-MM-DD.log`, kept for 30 days.
- **Tests never touch the network or the GPU.** Fetch, providers, `nvidia-smi`, the clock and the mailer are injected. Real pages and PDFs are saved as fixtures under `tests/fixtures/`.

## Review Focus

1. **Crash in the middle of a run.** The next run must pick up documents left at `found`, `read` or `triaged` without fetching or extracting them twice. It must also never publish the same figure twice: a value identical to the published one is a no-op. Tests are in Task 10.
2. **The first check of a source** must not flood the pipeline with years of old news. Its existing links are stored as `skipped` baselines, and only links that appear later are processed. Test in Task 4.
3. **Daylight-saving days** (2026-03-08 and 2026-11-01): each day still has exactly one 03:00 and one 10:00 New York slot, at the correct UTC instants. Catch-up fires once, not once per missed slot. Tests are in Task 11.
4. **Numbers in odd formats** in model output, such as "US$1.2 bn", "1,200 million" or "26 yrs", compared with a published value in a different unit. The ±20% rule must compare like with like, and anything it cannot compare is held. Test in Task 9.
5. **Quotes with line breaks, non-breaking spaces or curly quotes** from PDF text must still verify, while a paraphrased quote must fail. Test in Task 8.

---

### Task 1: Pipeline config, schema v2 and logger

**Files:**
- Modify: `src/config.ts`, `config/default.json`, `src/store/schema.ts`, `src/domain/types.ts`
- Create: `src/log.ts`, `.env.example`
- Test: `tests/config.test.ts`, `tests/store/db.test.ts`, `tests/log.test.ts`

**Interfaces:**
- Produces:
  - `AppConfig` gains `pipeline: PipelineConfig`, `logDir: string`
  - `PipelineConfig = { slots: string[]; autoPublishConfidence: number; numericChangeThreshold: number; maxDocChars: number; userAgent: string; fetch: { concurrency: number; perHostDelayMs: number; attempts: number }; gamingGuard: { gpuBusyPercent: number; postponeMinutes: number; gameProcesses: string[] }; providers: Record<string, ProviderConfig>; triageProvider: string; triageFallbackProvider: string; extractProvider: string; digestAfterSlot: string }`
  - `ProviderConfig = { kind: "ollama" | "openai"; baseUrl: string; model: string; apiKeyEnv?: string }`
  - `SCHEMA_VERSION = 2`
  - `createLogger(dir: string, now?: () => Date): Logger`, where `Logger = { info(msg: string, data?: object): void; warn(...); error(...) }`
  - `DocumentStatus = "found" | "read" | "triaged" | "extracted" | "done" | "failed" | "skipped"`

- [ ] **Step 1: Write the failing tests**
  - `config.test.ts`: `loadConfig({}).pipeline.slots` equals `["03:00", "10:00"]`; `autoPublishConfidence` is `0.8`; `numericChangeThreshold` is `0.2`; `triageProvider` is `"ollama"`; `extractProvider` is `"workersAi"`; `logDir` is `C:\GreenfieldsData\logs`.
  - `db.test.ts`: a fresh DB records `schema_version` `"2"`. A DB created by the v1 SQL (run Plan 1's `SCHEMA_SQL` text, saved as a test fixture string) and then opened with `openDb` ends at version 2 and has the columns `sources.render`, `sources.last_error`, `sources.first_checked_at`, `documents.project_id`, `documents.updated_at` and `field_values.hold_reason`.
  - `log.test.ts`: two lines logged on different days go to two files named `greenfields-YYYY-MM-DD.log` (the date in New York). Each line is JSON with `ts`, `level`, `msg`. Files older than 30 days are deleted when the logger is created.
- [ ] **Step 2: Run them.** `npx vitest run tests/config.test.ts tests/store/db.test.ts tests/log.test.ts`. Expected: FAIL (`pipeline` undefined, version `"1"`, no `log.ts`).
- [ ] **Step 3: Implement.**
  - `config/default.json` gets the `pipeline` block with the values above, plus:
    - `providers.ollama = { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "llama3.1:8b" }`
    - `providers.workersAi = { kind: "openai", baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", apiKeyEnv: "CLOUDFLARE_API_TOKEN" }`
    - `providers.claude = { kind: "openai", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", apiKeyEnv: "ANTHROPIC_API_KEY" }`
    - `triageFallbackProvider: "workersAi"`, `digestAfterSlot: "10:00"`, `maxDocChars: 60000`, `gameProcesses: []`
  - `{CLOUDFLARE_ACCOUNT_ID}` in a `baseUrl` is replaced from `env` by `loadConfig`.
  - **Schema migration:** `applySchema` keeps the v1 SQL, then applies the v2 `ALTER TABLE ... ADD COLUMN` statements only when the stored `schema_version` is `< 2`, and then updates the version, all in one transaction. Column defaults: `render INTEGER NOT NULL DEFAULT 0`; the rest are nullable TEXT except `project_id INTEGER REFERENCES projects(id)`.
  - Add a `CREATE INDEX` on `documents(status)`.
  - Re-create `.env.example` with every secret name from Global Constraints (empty values) and `GREENFIELDS_DATA_DIR=C:\GreenfieldsData`.
- [ ] **Step 4: Run them again.** Then `npm test` and `npm run typecheck`. Expected: all PASS, including Plan 1's 72 tests.
- [ ] **Step 5: Commit** — `feat(pipeline): pipeline config, schema v2 and daily logger`.

### Task 2: Sources store and `npm run sources`

**Files:**
- Create: `src/store/sources.ts`, `src/cli/sources.ts`, `data/sources.json`
- Modify: `package.json` (script `sources` = `tsx src/cli/sources.ts`)
- Test: `tests/store/sources.test.ts`

**Interfaces:**
- Produces:
  - `SourceKind = "ir_news" | "seia" | "cochilco" | "news_feed" | "newswire"`
  - `SourceRow = { id; url; kind; projectId: number | null; company: string | null; render: boolean; lastCheckedAt; firstCheckedAt; fingerprint; failureCount; health: "ok" | "unhealthy" | "changed"; lastError }`
  - `addSource(db, s: { url; kind; projectSlug?; company?; render? }): number` is idempotent by URL.
  - `listSources(db, { activeOnly?: boolean }): SourceRow[]`. `activeOnly` excludes sources whose project is `paused`.
  - `recordCheck(db, id, r: { ok: true; fingerprint: string; linksFound: number; at: string } | { ok: false; error: string; at: string }): void`
  - `syncSourcesFile(db, file): { added: number }`

- [ ] **Step 1: Write the failing tests** (`sources.test.ts`, with the Plan 1 fixture imported):
  - adding the same URL twice returns the same id
  - an unknown `projectSlug` throws `unknown project`
  - `recordCheck` failures raise `failureCount` and set `health` to `unhealthy` exactly on the 3rd consecutive failure
  - a success resets `failureCount` to 0 and `health` to `ok`
  - a success with `linksFound: 0` sets `health` to `changed`
  - the first success sets `firstCheckedAt`, and later ones keep it
  - `listSources({ activeOnly: true })` omits a paused project's source
- [ ] **Step 2: Run** `npx vitest run tests/store/sources.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/store/sources.ts` and the CLI:
  - `npm run sources -- list`
  - `npm run sources -- add <url> --kind ir_news [--project <slug>] [--company <name>] [--render]`
  - `npm run sources -- sync`, which reads `data/sources.json` (an array of `{url, kind, project?, company?, render?}`)
- [ ] **Step 4: Draft `data/sources.json` (spec §13).** For each of the 17 tracked projects, find the owner company's IR news or press-release listing page from the company's own website, and add one `ir_news` entry for it. Companies with several projects get one entry with `company` set and no `project`. Do not guess URLs: open each page and confirm it lists dated news. Leave out any company where no listing exists, and add it to a "no IR page" list in the task's ledger line. **The owner confirms this file before the first real run** (ask in the final message, not mid-plan).
- [ ] **Step 5: Run the tests again and run `npm test`.** Expected: PASS. Commit: `feat(sources): source store, CLI and drafted IR source list`.

### Task 3: Polite fetcher and robots.txt

**Files:**
- Create: `src/watch/robots.ts`, `src/watch/fetcher.ts`
- Test: `tests/watch/robots.test.ts`, `tests/watch/fetcher.test.ts`

**Interfaces:**
- Produces:
  - `isAllowed(robotsTxt: string, userAgent: string, url: string): boolean`. Supports `User-agent` groups (a specific match wins over `*`), `Allow`/`Disallow` longest-prefix match, `*` and `$` in paths, and treats an empty or missing file as allow-all.
  - `createFetcher(opts: { userAgent; concurrency; perHostDelayMs; attempts; fetchImpl?: typeof fetch; sleep?: (ms) => Promise<void>; now?: () => number }): Fetcher`
  - `Fetcher = { get(url: string): Promise<FetchResult> }`
  - `FetchResult = { ok: true; url: string; status: number; contentType: string; body: Uint8Array } | { ok: false; url: string; error: string; blockedByRobots?: boolean }`

- [ ] **Step 1: Write the failing tests.**
  - **robots:** the `GreenfieldsBot` group overrides `*`; `Disallow: /news/` with `Allow: /news/2026` allows `/news/2026/x`; `Disallow: /*.pdf$` blocks `/a.pdf` but not `/a.pdf?x`; an empty file allows everything.
  - **fetcher** (fake `fetchImpl`, fake `sleep` and `now`):
    - robots.txt is fetched once per host and cached
    - a robots 404 means allow-all
    - a disallowed URL returns `{ ok: false, blockedByRobots: true }` without fetching it
    - two URLs on the same host are ≥ `perHostDelayMs` apart
    - no more than `concurrency` requests are in flight
    - a 503 then a 200 returns ok after 2 attempts, with backoff sleeps of 1 s and then 4 s
    - 3 failures return `{ ok: false, error }` and never throw
    - every request sends the configured `User-Agent`
- [ ] **Step 2: Run** `npx vitest run tests/watch`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use a small promise semaphore and per-host "next allowed time" map; 4xx other than 408/429 is not retried; time-out each request at 30 s with `AbortSignal.timeout`.
- [ ] **Step 4: Run again.** Expected: PASS. Commit: `feat(watch): polite fetcher with robots.txt`.

### Task 4: Link discovery and the watcher

**Files:**
- Create: `src/watch/links.ts`, `src/watch/watcher.ts`, `tests/fixtures/pages/` (two or three saved real IR listing pages from `data/sources.json`, trimmed to under 200 KB each)
- Modify: `src/store/documents.ts`
- Test: `tests/watch/links.test.ts`, `tests/watch/watcher.test.ts`

**Interfaces:**
- Consumes: `Fetcher` (Task 3), `SourceRow`, `recordCheck` (Task 2)
- Produces:
  - `discoverLinks(html: string, pageUrl: string): DiscoveredLink[]`, where `DiscoveredLink = { url: string; title: string }`. URLs are absolute, with fragments and tracking parameters (`utm_*`) stripped, and deduplicated. Only same-site links and links ending in `.pdf` are kept. Navigation, login, social and `mailto:` links are dropped, as are links whose text is under 12 characters unless they point to a PDF.
  - `linksFingerprint(links): string` is the SHA-256 of the sorted URLs.
  - `watchSources(db, fetcher, sources: SourceRow[], log, nowIso): Promise<{ checked: number; newDocuments: number; failed: number }>`
  - `documents.ts` gains `addFoundDocument(db, { url, title, sourceId, projectId, status: "found" | "skipped" }): number | null` (`null` if the URL is already known), `setDocumentStatus(db, id, status, patch?: { text?; triage?; error?; projectId? })` and `listDocumentsByStatus(db, statuses: DocumentStatus[]): DocumentRow[]`.

- [ ] **Step 1: Write the failing tests.**
  - **links**, on each saved fixture page: the expected news item URLs (list 3 per fixture, checked by hand) are present; the site's nav and footer links are absent; relative links resolve against the page URL.
  - **watcher**, with a fake fetcher serving fixtures:
    - The first check of a source stores every link as `skipped` and sets `firstCheckedAt`.
    - A second check whose page has one extra link stores exactly one `found` document, carrying the source's `projectId`.
    - An unchanged fingerprint adds nothing.
    - A fetch failure calls `recordCheck` with `ok: false` and does not throw.
    - A source with `render: true` is skipped by `watchSources` when no renderer is passed, and logged once.
- [ ] **Step 2: Run** `npx vitest run tests/watch`. Expected: FAIL.
- [ ] **Step 3: Implement** with `cheerio`. The watcher checks sources with the fetcher's own concurrency limit. For `render` sources it takes an optional `render(url) => Promise<string>` from Task 5.
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(watch): link discovery and source watcher with first-run baseline`.

### Task 5: Reader (HTML, PDF, rendered pages)

**Files:**
- Create: `src/read/html.ts`, `src/read/pdf.ts`, `src/read/render.ts`, `src/read/reader.ts`, `tests/fixtures/docs/` (one saved news-release HTML page and one short real PDF, such as a 2–6 page technical-report summary or press release, both from tracked companies)
- Test: `tests/read/reader.test.ts`

**Interfaces:**
- Consumes: `Fetcher` (Task 3), the documents store (Task 4)
- Produces:
  - `htmlToText(html: string): { title: string; text: string }`. Drops `script`, `style`, `nav`, `header`, `footer` and `aside`; prefers `article` or `main` when they exist; keeps paragraph breaks as `\n\n` and table rows as tab-separated lines.
  - `pdfToText(bytes: Uint8Array): Promise<string>` uses `unpdf`, with pages joined by `\n\n`.
  - `renderPage(url, userAgent): Promise<string>` loads `playwright` with a dynamic `import()`. If it isn't installed, it throws `playwright is not installed: npm i -D playwright && npx playwright install chromium`.
  - `readFoundDocuments(db, fetcher, log, opts: { render?: typeof renderPage }): Promise<{ read: number; failed: number }>` moves each `found` document to `read` (with its text) or to `failed` (with an error). It decides PDF or HTML by `content-type`, falling back to the `.pdf` extension.

- [ ] **Step 1: Write the failing tests.**
  - The HTML fixture's text contains its headline and a sentence from its body, checked by hand, and contains no menu text.
  - The PDF fixture's text contains a known figure string, checked by hand.
  - `readFoundDocuments` with a fake fetcher moves one doc to `read` and a 404 doc to `failed` with `error` containing `404`.
  - `renderPage` with the `import()` stubbed to reject throws the install message.
- [ ] **Step 2: Run** `npx vitest run tests/read`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `cheerio` and `unpdf` as dependencies and `playwright` as an **optional** dependency (`optionalDependencies`), so a normal install does not download a browser.
- [ ] **Step 4: Run again.** Expected: PASS. Commit: `feat(read): HTML, PDF and rendered-page readers`.

### Task 6: ModelProvider

**Files:**
- Create: `src/ai/provider.ts`
- Test: `tests/ai/provider.test.ts`

**Interfaces:**
- Produces:
  - `ModelProvider = { name: string; chatJson(req: { system: string; user: string; schemaHint: string }): Promise<string> }`, which returns the model's raw JSON text.
  - `QuotaExceededError extends Error`
  - `createProvider(name: string, cfg: ProviderConfig, env, fetchImpl?): ModelProvider`
    - The `ollama` kind POSTs `${baseUrl}/api/chat` with `{ model, messages, stream: false, format: "json", keep_alive: "30s", options: { temperature: 0 } }` and reads `message.content`.
    - The `openai` kind POSTs `${baseUrl}/chat/completions` with `Authorization: Bearer <env[apiKeyEnv]>`, `temperature: 0` and `response_format: { type: "json_object" }`, and reads `choices[0].message.content`.

- [ ] **Step 1: Write the failing tests** with a fake `fetchImpl`. Each kind sends the request body above and returns the content. A missing API key env var throws `ANTHROPIC_API_KEY is not set` (for example). HTTP 429, or a Cloudflare error body with code `4006`, throws `QuotaExceededError`. Any other non-2xx throws an `Error` with the status and the first 300 characters of the body.
- [ ] **Step 2: Run** `npx vitest run tests/ai`. Expected: FAIL.
- [ ] **Step 3: Implement.** A 120 s timeout per call. No SDKs.
- [ ] **Step 4: Run again.** Expected: PASS. Commit: `feat(ai): ModelProvider for Ollama and OpenAI-compatible APIs`.

### Task 7: Triage

**Files:**
- Create: `src/pipeline/modelJson.ts`, `src/pipeline/triage.ts`, `src/pipeline/prompts.ts`
- Test: `tests/pipeline/triage.test.ts`

**Interfaces:**
- Consumes: `ModelProvider` (Task 6), `ProjectRow`, the documents store
- Produces:
  - `askJson<T>(provider, schema: z.ZodType<T>, req): Promise<T>` parses the reply, which may be wrapped in a ```` ```json ```` fence. If parsing or validation fails, it retries once, sending the validation error back. If that also fails, it throws `InvalidModelOutputError`.
  - `TriageResult = { projectSlug: string | null; category: "study" | "resource" | "drilling" | "permit" | "ownership" | "financing" | "routine"; material: boolean; possibleNewProject: boolean; reason: string }`
  - `triageDocument(provider, doc: { title; text }, candidates: ProjectRow[], maxChars): Promise<TriageResult>`
  - `triageReadDocuments(db, provider, log, opts: { maxChars }): Promise<{ triaged: number; routine: number; failed: number }>` stores the result as JSON in `documents.triage` and sets the document's project from `projectSlug`. It then sets the status:
    - `triaged` when `material` is true and the document has a project
    - `done` for routine or immaterial documents, and for documents with no project
    - `failed` when the model output is still invalid after the retry

  Candidates are the source's own project, or every active project when the source is company-wide.
  Triage reads only the first 8,000 characters. Extraction gets more (Task 8).

- [ ] **Step 1: Write the failing tests** with a scripted fake provider:
  - a valid reply moves the doc to `triaged` with its project set
  - a `routine` reply sets `done`
  - a `projectSlug` not among the candidates is treated as null, which sets `done` and logs it
  - fenced JSON parses
  - an invalid reply followed by a valid one makes exactly 2 calls, and the second prompt contains the zod error text
  - two invalid replies set `failed`, with `InvalidModelOutputError` in `error`
- [ ] **Step 2: Run** `npx vitest run tests/pipeline/triage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The prompt in `prompts.ts` gives the greenfield definition from spec §2, the category list, and the candidates as `slug — name — owners — aliases`. It asks for JSON only.
- [ ] **Step 4: Run again.** Expected: PASS. Commit: `feat(pipeline): triage with schema-checked model output`.

### Task 8: Extraction and quote verification

**Files:**
- Create: `src/pipeline/verify.ts`, `src/pipeline/extract.ts`
- Test: `tests/pipeline/verify.test.ts`, `tests/pipeline/extract.test.ts`

**Interfaces:**
- Consumes: `askJson` (Task 7), `getPublished` (Plan 1), `FIELD_LABELS`
- Produces:
  - `normalizeForQuote(s: string): string` lowercases the text, maps curly quotes and dashes to ASCII, maps NBSP to a space, removes soft hyphens, and collapses all whitespace to single spaces.
  - `quoteFound(quote: string, text: string): boolean` requires a non-empty quote of at least 15 normalized characters.
  - `ProposedFigure = { field: FieldKey | "stage" | "owners" | "minerals"; valueText: string; valueNum: number | null; unit: string | null; basis: Basis; attributableShare: number | null; figureDate: string | null; confidence: number; quote: string }`
  - `extractFigures(provider, doc: { title; text }, project: ProjectRow, published: FieldValueRow[], maxChars): Promise<ProposedFigure[]>` returns the figures that **passed** verification. It logs each dropped figure with its field and quote.

- [ ] **Step 1: Write the failing tests.**
  - **verify:**
    - a quote matches across a PDF line break
    - curly quotes and NBSP match their ASCII forms
    - a paraphrase with one word changed fails
    - a 10-character quote fails
  - **extract**, with a fake provider returning 3 figures (one whose quote is not in the text):
    - 2 figures come back
    - the prompt contains the project's current published `capex_usd` value text
    - `confidence` outside 0–1 counts as invalid output (the retry path)
    - the document text sent is cut to `maxChars`
- [ ] **Step 2: Run** `npx vitest run tests/pipeline/verify.test.ts tests/pipeline/extract.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The prompt tells the model to:
  - report only figures stated in the document
  - copy the quote verbatim
  - give values on a 100% basis where the document allows it, otherwise `attributable` with the share
  - put US$ amounts in `valueNum` as plain dollars (1.2 billion becomes 1200000000)
  - give mine life in years
  - leave out anything it is unsure of
- [ ] **Step 4: Run again.** Expected: PASS. Commit: `feat(pipeline): figure extraction with quote verification`.

### Task 9: Publish/hold rules

**Files:**
- Create: `src/pipeline/rules.ts`
- Test: `tests/pipeline/rules.test.ts`

**Interfaces:**
- Consumes: `ProposedFigure` (Task 8), `FieldValueRow`, `insertFieldValue`, `publishFieldValue` (Plan 1)
- Produces:
  - `Decision = { action: "publish" } | { action: "hold"; reason: string } | { action: "skip"; reason: "unchanged" }`
  - `RuleSettings = { minConfidence: number; numericThreshold: number }`
  - `decide(fig: ProposedFigure, current: FieldValueRow | undefined, ctx: RuleSettings & { material: boolean; conflict: boolean }): Decision`
  - `SourcedFigure = ProposedFigure & { documentId: number; material: boolean }`
  - `applyFigures(db, projectId, figs: SourcedFigure[], settings: RuleSettings, decidedAt): { published: number; held: number; skipped: number }` takes every figure for one project from the whole run, so it can mark conflicts between documents.
  - Held figures are inserted as `pending` with `hold_reason`. Published ones are inserted as `pending` and then published with `publishFieldValue(…, "auto")`.

- [ ] **Step 1: Write the failing tests**, one per rule, with the Global Constraints values:
  - **Publish:**
    - a new field with confidence 0.9 from a material document
    - a numeric change from 2.4e9 to 2.7e9 (+12.5%)
  - **Hold** (expected reason in brackets):
    - 2.4e9 to 3.0e9, +25% (`change beyond ±20%`)
    - confidence 0.7 (`low confidence`)
    - fields `stage`, `owners` or `minerals` (`stage/owner/mineral change`)
    - a text change where either side has no number (`text change`)
    - a different `unit` on the two sides (`units differ`)
    - an immaterial document (`immaterial document`)
    - two different values for the same field in one batch (`conflicting sources`), for both figures
  - **Skip:** the same normalized `valueText` as the published value (`unchanged`).
  - `applyFigures`: published and held rows have `document_id`, `quote` and `confidence` set; the old published row becomes `superseded` only on publish.
- [ ] **Step 2: Run** `npx vitest run tests/pipeline/rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The rule order is: skip unchanged, then hold for each condition in the order above, then publish. The relative change is `|new − old| / |old|`, and `old = 0` holds.
- [ ] **Step 4: Run again.** Expected: PASS. Commit: `feat(pipeline): auto-publish and hold rules`.

### Task 10: Run orchestrator and `npm run run-once`

**Files:**
- Create: `src/store/runs.ts`, `src/pipeline/run.ts`, `src/cli/runOnce.ts`
- Modify: `package.json` (script `run-once` = `tsx src/cli/runOnce.ts`)
- Test: `tests/pipeline/run.test.ts`, `tests/store/runs.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9, plus `publish`/`Deployer` from Plan 1
- Produces:
  - `RunTrigger = "schedule" | "manual" | "catch-up"`
  - `startRun(db, trigger, at): number`, `finishRun(db, id, { counts, errors, postponed, published, at })`, `lastRunStartedAt(db): string | null`
  - `PipelineDeps = { fetcher; providers: { triage: ModelProvider; extract: ModelProvider }; deploy: Deployer | null; render?; log; now: () => Date }`
  - `runPipeline(db, cfg, deps, opts: { trigger: RunTrigger; dryRun?: boolean }): Promise<RunSummary>`
  - `RunSummary = { runId; counts: { checked; newDocuments; read; triaged; extracted; published; held; failed }; errors: string[]; deployed: boolean }`

  Stage order: watch → read (all `found`) → triage (all `read`) → extract and apply (all `triaged`) → publish.
  Each stage also picks up documents left in its input status by an earlier run.
  During extraction, a `QuotaExceededError` stops the stage, logs it, and leaves the remaining documents `triaged`. A deploy error goes into `errors`, and the run still finishes.
  With `dryRun`, `deploy` is skipped and the DB is a copy made with `VACUUM INTO` in a temp dir (done in the CLI, not in `runPipeline`).

- [ ] **Step 1: Write the failing tests** (in-memory DB, Plan 1 fixture, fake fetcher, scripted providers, recording deployer):
  - **Happy path:** one new link leads to read, triage (material), extraction of 1 new figure, publish and 1 deploy. `runs` has one row with `published = 1` and its counts.
  - **Resume:** a document seeded at `triaged` from an "earlier run" is extracted without any fetch of its URL.
  - **Quota:** the extract provider throws `QuotaExceededError` on the 2nd of 3 documents. Docs 2 and 3 stay `triaged`, the run's `errors` is empty, and `counts.extracted` is 1.
  - **Idempotent:** running twice over the same fixtures publishes once and deploys once.
  - **Deploy fails:** `errors` contains the deploy message and the run still has `ended_at`.
  - **runs store:** `lastRunStartedAt` returns the newest `started_at`.
- [ ] **Step 2: Run** `npx vitest run tests/pipeline/run.test.ts tests/store/runs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `runPipeline`, then the CLI:
  - `npm run run-once` loads `.env` (as `cli/publish.ts` does), builds the real deps from config, and prints the summary as a table with `formatTable`.
  - `--dry-run` uses the DB copy and no deploy.
  - `--no-publish` skips only the deploy.
  - `--triage-provider <name>` overrides the triage provider.
  - It exits 1 when `errors` is non-empty.
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(pipeline): run orchestrator with resume, quota carry-over and dry-run`.

### Task 11: Scheduler, gaming guard and `npm start`

**Files:**
- Create: `src/schedule/slots.ts`, `src/schedule/gamingGuard.ts`, `src/schedule/daemon.ts`, `src/cli/start.ts`, `scripts/install-task.ps1`
- Modify: `package.json` (script `start` = `tsx src/cli/start.ts`), `src/pipeline/run.ts` (the triage stage calls the guard)
- Test: `tests/schedule/slots.test.ts`, `tests/schedule/gamingGuard.test.ts`, `tests/schedule/daemon.test.ts`

**Interfaces:**
- Produces:
  - `zonedTimeToUtc(dateYmd: string, hhmm: string, tz: string): Date`. It uses `Intl.DateTimeFormat` offsets with no library. A wall time that does not exist resolves to the first valid instant after it.
  - `nextSlot(after: Date, slots: string[], tz): { at: Date; slot: string }`
  - `latestSlot(atOrBefore: Date, slots, tz): { at: Date; slot: string }`
  - `GpuProbe = () => Promise<{ gpuPercent: number | null; runningGames: string[] }>`. The real probe runs `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits` and `tasklist /fo csv /nh` through `execFile`. A missing `nvidia-smi` gives `gpuPercent: null`, which counts as "not busy".
  - `waitForQuietGpu(probe, cfg, deps: { sleep; now; deadline: Date; log }): Promise<{ useFallback: boolean; postponed: boolean }>`
  - `startDaemon(deps: { db; cfg; makePipelineDeps; now; setTimer; log }): { stop(): void }`

  At startup, the daemon runs a `catch-up` run when no run has started since `latestSlot(now)`. It then sets a timer for `nextSlot` and runs `schedule` runs. It never runs two runs at once: a slot that arrives during a run is skipped and logged.

- [ ] **Step 1: Write the failing tests.**
  - **slots:**
    - `zonedTimeToUtc("2026-07-01", "10:00", NY)` is `14:00Z`
    - `zonedTimeToUtc("2026-12-01", "10:00", NY)` is `15:00Z`
    - on 2026-03-08 the 03:00 slot is `07:00Z`
    - on 2026-11-01 the 03:00 slot is `08:00Z`
    - `nextSlot` from `2026-11-01T07:30Z` is the 03:00 slot at `08:00Z`
    - `nextSlot` just after the 10:00 slot is the next day's 03:00
    - `latestSlot` at exactly a slot instant returns that slot
  - **guard:**
    - GPU at 10% gives no postponement
    - GPU at 80% and then 10% gives one 30-minute sleep and `postponed: true`
    - a running process named in `gameProcesses` counts as busy
    - busy until past the `deadline` gives `useFallback: true`
    - a `null` GPU reading counts as quiet
  - **daemon** (fake timers and pipeline):
    - startup with no runs at all triggers 1 catch-up
    - startup right after a slot that already has a run triggers none
    - the timer fires at the next slot with trigger `schedule`
    - a run that throws is logged and the next timer is still set
- [ ] **Step 2: Run** `npx vitest run tests/schedule`. Expected: FAIL.
- [ ] **Step 3: Implement.** The triage stage in `runPipeline` calls `waitForQuietGpu`, with the deadline set to the next slot, only when the triage provider's kind is `ollama`. It switches to `triageFallbackProvider` when told to, and sets `runs.postponed`.
- [ ] **Step 4: Write `start.ts` and `scripts/install-task.ps1`.**
  - `start.ts` loads `.env`, creates the logger, opens the DB and calls `startDaemon`. It logs `ready` with the next slot and handles `SIGINT` by stopping cleanly.
  - `scripts/install-task.ps1` uses `Register-ScheduledTask` to create a task named `Greenfields`. The task:
    - starts at system startup
    - runs as the current user whether logged on or not
    - has its working directory set to the repo
    - runs `npm.cmd start`
    - restarts every 1 minute up to 999 times
    - has no time limit
  - The script is written but **not run**. Running it is an owner step in the README.
- [ ] **Step 5: Run again, then `npm test`.** Expected: PASS. Commit: `feat(schedule): NY-time slots, catch-up, gaming guard and daemon`.

### Task 12: Daily digest email

**Files:**
- Create: `src/notify/digest.ts`, `src/notify/mailer.ts`
- Modify: `src/schedule/daemon.ts` (after a run for slot `digestAfterSlot`, call `maybeSendDigest`)
- Test: `tests/notify/digest.test.ts`

**Interfaces:**
- Produces:
  - `buildDigest(db, nowIso, tz): { subject: string; text: string } | null` returns `null` when there is nothing to report. It reports:
    - pending field values: project, field, current → proposed value, hold reason and source URL
    - pending suggestions (a count)
    - `unhealthy` or `changed` sources
    - documents that became `failed` in the last 24 h
    - the last run's errors
  - `Mailer = (msg: { to; subject; text }) => Promise<void>`
  - `gmailMailer(env): Mailer` uses `nodemailer` with `smtp.gmail.com`, port 465, `secure: true`.
  - `maybeSendDigest(db, mailer, nowIso, tz, to): Promise<"sent" | "nothing" | "already-sent">` records `meta.last_digest_date` (the New York date) only after a successful send.

- [ ] **Step 1: Write the failing tests.**
  - With no items, the result is `nothing` and the mailer is not called.
  - With 1 pending capex change, the text contains the project name, both values and the hold reason, and the subject is `Greenfields: 1 change to review`.
  - A second call on the same New York date returns `already-sent`.
  - A mailer that throws leaves `last_digest_date` unset, so the next run retries.
  - A missing `GMAIL_APP_PASSWORD` makes `gmailMailer` throw `GMAIL_APP_PASSWORD is not set`.
- [ ] **Step 2: Run** `npx vitest run tests/notify`. Expected: FAIL.
- [ ] **Step 3: Implement.** Plain text only. The digest is skipped in dry-run.
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS. Commit: `feat(notify): daily Gmail digest of held changes and source health`.

### Task 13: Accuracy test scaffold and README

**Files:**
- Create: `src/cli/evalModels.ts`, `src/eval/score.ts`, `eval/README.md`, `eval/cases/.gitkeep`
- Modify: `package.json` (script `eval` = `tsx src/cli/evalModels.ts`), `README.md`
- Test: `tests/eval/score.test.ts`

**Interfaces:**
- Produces:
  - Eval case format, one folder per case under `eval/cases/<id>/`:
    - `doc.txt` or `doc.pdf`
    - `project.json`, containing the slug
    - `expected.json`, of shape `{ triage: { material; category }, figures: { field, valueText, valueNum? }[] }`
  - `scoreFigures(expected, actual): { precision: number; recall: number; matched: number }`. A figure matches on the same field, plus either `valueNum` within 1% or equal normalized `valueText`.
  - `npm run eval -- --triage <provider> --extract <provider>` runs every case and prints per-case and overall triage accuracy and figure precision/recall.

- [ ] **Step 1: Write the failing test** for `scoreFigures`: 2 expected and 3 actual with 2 matching gives precision 0.667 and recall 1. `valueNum` 2.42e9 matches 2.4e9 (within 1%). A different field does not match.
- [ ] **Step 2: Run** `npx vitest run tests/eval`. Expected: FAIL.
- [ ] **Step 3: Implement the scorer and CLI.**
  - Commit the empty `eval/cases/`.
  - `eval/README.md` tells the owner how to add 10–20 hand-checked cases (spec §11), and that the triage and extraction models in `config/default.json` are chosen from these scores (spec §13).
- [ ] **Step 4: Update `README.md`** with new sections:
  - **Ollama:** install it, run `ollama pull llama3.1:8b`, and set it to start with Windows.
  - **Cloudflare token:** add the Workers AI › Read permission to the existing token.
  - **Gmail:** create an app password and set `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `DIGEST_TO`.
  - **Sources:** review `data/sources.json`, then run `npm run sources -- sync`.
  - **First run:** `npm run run-once -- --dry-run`, then `npm run run-once`.
  - **Always on:** run `scripts/install-task.ps1` as administrator, then check `logs/`.
  - **Optional:** `npm i -D playwright && npx playwright install chromium` for sources marked `--render`.
- [ ] **Step 5: Run `npm test` and `npm run typecheck`.** Expected: all PASS. Commit: `feat(eval): accuracy scoring scaffold; docs: pipeline setup`.

---

## After the plan (owner steps, not tasks)

1. Confirm or correct `data/sources.json`, then `npm run sources -- sync`.
2. Install Ollama and pull the model; add Workers AI permission to the token; fill the Gmail values in `.env`.
3. `npm run run-once -- --dry-run`, look at the summary, then a real `npm run run-once`.
4. Run `scripts/install-task.ps1` once.
5. Add hand-checked eval cases and pick the final models.
