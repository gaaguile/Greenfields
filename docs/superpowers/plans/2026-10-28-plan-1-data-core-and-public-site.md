# Greenfields Plan 1 — Data Core and Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the existing dataset into SQLite, build the public `projects.json`, and deploy a sortable/filterable table site to Cloudflare Pages at `greenfields.gabrieltekken.com`.

**Architecture:** A TypeScript Node project. The server-side modules are store (SQLite through `node:sqlite`), domain helpers, import, and publish. The CLIs run with `tsx`. The public site is a separate folder of plain TypeScript bundled by esbuild into `dist/site/`, together with the generated `projects.json`, and deployed with `wrangler pages deploy`. This is the first of four plans; the later plans add the update pipeline (Plan 2), the review page and tunnel (Plan 3), and discovery (Plan 4) on top of these modules.

**Tech Stack:** Node 24 (`node:sqlite`), TypeScript 5, tsx, Vitest, esbuild, wrangler.

**Spec:** `docs/superpowers/specs/2026-10-28-greenfields-design.md` (sections 2, 4, 7, 10, 11 are implemented here; §3 module layout is started).

## Global Constraints

- Node ≥ 24 (installed: v24.16.0). Use built-in `node:sqlite` (`DatabaseSync`); no native SQLite package.
- All code is TypeScript, `"type": "module"`, `strict: true`.
- The live DB path defaults to `D:\GreenfieldsData\greenfields.db`, overridable by env `GREENFIELDS_DATA_DIR`. The DB is never inside the repo or OneDrive.
- Secrets live only in `.env` (git-ignored); `.env.example` is committed.
- The public site is English only, with no framework. Missing values show as `—`.
- `projects.json` contains only `published` field values.
- The table shows the **100% basis**; the attributable share appears only in the detail view.
- Stage categories (in this order): `exploration`, `advanced_exploration`, `scoping_pea`, `pfs`, `fs`, `permitting`, `construction`, plus a separate `stalled` boolean. Labels: Exploration, Advanced exploration, Scoping/PEA, PFS, FS, Permitting (EIA/SEIA), Construction decision / construction. *(The spec lists "Construction decision"; the dataset has 2 projects in construction, so that category also covers construction.)*
- Timestamps are ISO-8601 UTC strings. Display times use the `America/New_York` zone.
- Public site domain: `greenfields.gabrieltekken.com`; Pages project name: `greenfields`.

## Review Focus

1. **Accented text** (NuevaUnión, Valparaíso, Tarapacá, Chañar): search must be accent- and case-insensitive ("nueva union" finds NuevaUnión), and CSV must be UTF-8 with a BOM so Excel shows accents. Tests are in Task 6 and Task 7.
2. **CSV values containing commas, quotes or line breaks** (Additional info, owner strings like "Barrick / Newmont (50/50 JV; …)") must survive a round trip. Test in Task 7.
3. **Missing figures:** most projects lack capex or mine life. They render `—` and sort **last** in both ascending and descending order. Test in Task 6.
4. **Re-running the import** on a populated DB must not create duplicates (projects are matched by slug), and a re-import must not change values that were already published. Test in Task 4.
5. **A failed deploy** (missing token, wrangler error) must exit non-zero and must not record the published hash, so the next publish retries. Test in Task 8.

---

### Task 1: Project scaffold and config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `config/default.json`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig` where
  `AppConfig = { dataDir: string; dbPath: string; siteOutDir: string; pagesProjectName: string; recentChangeDays: number; timezone: string }`.

- [ ] **Step 1: Create the scaffold**
  - **`package.json`:**
    - `"type": "module"`, `"engines": { "node": ">=24" }`
    - devDependencies: `typescript`, `tsx`, `vitest`, `esbuild`, `wrangler`, `@types/node`
    - scripts:
      - `test` = `vitest run`
      - `typecheck` = `tsc --noEmit`
      - `import` = `tsx src/cli/import.ts`
      - `db:show` = `tsx src/cli/dbShow.ts`
      - `build:site` = `tsx src/cli/buildSite.ts`
      - `publish` = `tsx src/cli/publish.ts`
  - **`tsconfig.json`:** `strict`, `module`/`moduleResolution` `NodeNext`, `target` `ES2023`, `noEmit`; includes `src`, `site/src` and `tests`.
  - **`.gitignore`:** `node_modules/`, `dist/`, `.env`, `*.db`, `.wrangler/`
  - **`.env.example`:** `GREENFIELDS_DATA_DIR=D:\GreenfieldsData`, `CLOUDFLARE_API_TOKEN=`, `CLOUDFLARE_ACCOUNT_ID=`
  - **`config/default.json`:** `{ "pagesProjectName": "greenfields", "recentChangeDays": 7, "timezone": "America/New_York" }`
  - Run `npm install`.

- [ ] **Step 2: Write failing tests** in `tests/config.test.ts`
  - `loadConfig({})` → `dataDir === "D:\\GreenfieldsData"` and `dbPath === path.join(dataDir, "greenfields.db")`.
  - `loadConfig({ GREENFIELDS_DATA_DIR: "D:\\x" })` → `dbPath === path.join("D:\\x", "greenfields.db")`.
  - `siteOutDir` is `<repo>/dist/site`; `pagesProjectName === "greenfields"`; `recentChangeDays === 7`.

- [ ] **Step 3: Run** `npm test -- tests/config.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `loadConfig`** in `src/config.ts`. It reads `config/default.json` relative to the repo root (resolved from `import.meta.url`) and applies the env override.

- [ ] **Step 5: Run** `npm test -- tests/config.test.ts && npm run typecheck`. Expected: PASS, no type errors.

- [ ] **Step 6: Commit**: `git add -A && git commit -m "chore: scaffold TypeScript project and config"`

---

### Task 2: SQLite store — schema and open

**Files:**
- Create: `src/store/db.ts`, `src/store/schema.ts`
- Test: `tests/store/db.test.ts`

**Interfaces:**
- Produces:
  - `openDb(path: string): DatabaseSync` — creates the parent dir, enables `PRAGMA foreign_keys = ON` and `journal_mode = WAL`, and applies the schema idempotently. `":memory:"` is allowed (used by every test).
  - `SCHEMA_VERSION = 1`.
- Tables (spec §4) — columns, snake_case:
  - `projects(id INTEGER PK, slug TEXT UNIQUE NOT NULL, name, aliases TEXT /*JSON array*/, owners, minerals TEXT /*JSON array of raw names*/, region, province, location_detail, lat REAL, lon REAL, stage, stage_text, stalled INTEGER, tracking TEXT DEFAULT 'active', created_at, updated_at)`
  - `sources(id PK, url TEXT UNIQUE, kind, project_id NULL REFERENCES projects, company TEXT NULL, last_checked_at, fingerprint, failure_count INTEGER DEFAULT 0, health TEXT DEFAULT 'ok')`
  - `documents(id PK, url TEXT UNIQUE, source_id NULL, title, published_at, fingerprint, text, triage TEXT /*JSON*/, status TEXT, error, created_at)`
  - `field_values(id PK, project_id NOT NULL, field, value_text NOT NULL, value_num REAL, unit, basis TEXT DEFAULT '100%', attributable_share REAL, figure_date, document_id NULL, quote, confidence REAL, status, decided_by, created_at, decided_at)` plus an index on `(project_id, field, status)`
  - `suggestions(id PK, data TEXT /*JSON*/, document_ids TEXT, duplicate_of NULL, status, created_at)`
  - `runs(id PK, started_at, ended_at, trigger, counts TEXT, errors TEXT, postponed INTEGER, published INTEGER)`
  - `meta(key TEXT PK, value TEXT)` — holds `schema_version` and `last_published_hash`

- [ ] **Step 1: Write failing tests**
  - after `openDb(":memory:")`, the `sqlite_master` table names include all 7 tables
  - calling the schema apply twice on the same DB does not throw
  - `meta.schema_version === "1"`
  - inserting a `field_values` row with a non-existent `project_id` throws (foreign keys are on)

- [ ] **Step 2: Run** `npm test -- tests/store/db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `schema.ts` (the SQL as a string constant using `CREATE TABLE IF NOT EXISTS`) and `openDb`. Node prints an "ExperimentalWarning" for `node:sqlite`; leave it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(store): sqlite schema and openDb`

---

### Task 3: Domain helpers and repositories

**Files:**
- Create: `src/domain/types.ts`, `src/domain/stage.ts`, `src/domain/minerals.ts`, `src/domain/fields.ts`, `src/store/projects.ts`, `src/store/fieldValues.ts`, `src/store/documents.ts`
- Test: `tests/domain/stage.test.ts`, `tests/domain/minerals.test.ts`, `tests/store/fieldValues.test.ts`

**Interfaces:**
- Produces (domain):
  - `type StageCategory = "exploration" | "advanced_exploration" | "scoping_pea" | "pfs" | "fs" | "permitting" | "construction"`
  - `STAGE_LABELS: Record<StageCategory, string>`, `STAGE_ORDER: StageCategory[]`
  - `normalizeStage(text: string): { stage: StageCategory; stalled: boolean }`
  - `mineralSymbol(raw: string): string` — e.g. Copper→Cu, Gold→Au, Silver→Ag, Molybdenum→Mo, "Lithium (brine)"→Li, "Potassium chloride (byproduct)"→K. Unknown names are returned unchanged.
  - `type FieldKey = "capex_usd" | "mine_life_years" | "resource_headline" | "reserve_headline" | "annual_production" | "grade" | "c1_cost" | "throughput_tpd" | "additional_info"`; `FIELD_LABELS: Record<FieldKey, string>`
  - `type FieldStatus = "published" | "pending" | "rejected" | "superseded"`
- Produces (store):
  - `upsertProject(db, p: NewProject): { id: number; created: boolean }` — matches on `slug`; on match it updates descriptive columns only.
  - `listProjects(db, opts?: { tracking?: "active" | "paused" }): ProjectRow[]`
  - `slugify(name: string): string` — lowercases, strips accents, non-alphanumerics → `-`. "NuevaUnión" → `nuevaunion`.
  - `upsertDocument(db, d: { url: string; title?: string; publishedAt?: string; status: string }): number` — matches on url.
  - `insertFieldValue(db, v: NewFieldValue): number` — `NewFieldValue` has every `field_values` column except id and created_at, in camelCase.
  - `publishFieldValue(db, id: number, decidedBy: "auto" | "owner"): void` — in one transaction: sets earlier `published` rows for the same `(project_id, field)` to `superseded`, sets this row to `published`, and sets `decided_at`.
  - `getPublished(db, projectId: number): FieldValueRow[]`
  - `getHistory(db, projectId: number, sinceIso?: string): FieldValueRow[]` — published + superseded rows ordered by `decided_at` desc.

- [ ] **Step 1: Write failing tests**
  - **`stage.test.ts`** — each dataset string maps as below:
    | Dataset stage text | Expected |
    |---|---|
    | "Pre-Feasibility Study (PFS) completed" | `pfs`, not stalled |
    | "Feasibility-level studies historically completed; no construction decision taken — long-stalled" | `fs`, stalled |
    | "Pre-feasibility level; long-stalled, no updated timeline" | `pfs`, stalled |
    | "Construction (targeting start-up mid-2026)" | `construction` |
    | "Environmentally approved (RCA granted); pre-construction…" | `permitting` |
    | "Preliminary Economic Assessment (PEA, Feb 2026)…" | `scoping_pea` |
    | "Advanced permitting / feasibility-stage development" | `permitting` |
    | "Exploration and scoping" | `scoping_pea` |
    | "Exploration and resource definition" | `advanced_exploration` |
    | "Exploration / pre-feasibility evaluation" | `pfs` |
    | "Exploration / early studies" | `exploration` |
    | "Exploration and early permitting" | `exploration` |
  - **`minerals.test.ts`:** the symbols listed in Interfaces.
  - **`fieldValues.test.ts`:**
    - publishing value A, then value B for the same field leaves A `superseded` and B `published`
    - `getPublished` returns only B
    - `getHistory` returns `[B, A]`

- [ ] **Step 2: Run** the three test files. Expected: FAIL.

- [ ] **Step 3: Implement `normalizeStage`** as ordered keyword rules. The first match wins, and the order is what makes the table in Step 1 pass:
  ```
  stalled = /stalled/i
  construction (not "pre-construction"/"construction decision taken") → construction
  /permitting|RCA|environmentally approved/i (but "early permitting" → exploration) → permitting
  /(?<!pre-?)\bfeasibility\b/i → fs
  /pre-?feasibility|\bPFS\b/i → pfs
  /\bPEA\b|scoping|preliminary economic/i → scoping_pea
  /resource definition|advanced exploration/i → advanced_exploration
  default → exploration
  ```

- [ ] **Step 4: Implement** the minerals, fields and store modules per Interfaces. Store JSON array columns with `JSON.stringify`.

- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**: `feat(domain): stage/mineral normalization and field value repository`

---

### Task 4: Import the existing dataset

**Files:**
- Create: `src/import/importDataset.ts`, `src/cli/import.ts`
- Test: `tests/import/importDataset.test.ts`, fixture `tests/fixtures/dataset-small.json` (3 projects copied from the real file: Vizcachitas, Cerro Casale, Proyecto Blanco)

**Interfaces:**
- Consumes: Task 3 store and domain functions.
- Produces: `importDataset(db, dataset: unknown, importedAt: string): { created: number; updated: number; figures: number }`

**Mapping (dataset → DB):**
- **Projects:**
  - `name` → name; `slugify(name)` → slug; `owner` → owners
  - `minerals` → minerals (raw names)
  - `location.region/province/detail` → region/province/location_detail
  - `development_stage` → `stage_text`, plus `normalizeStage` → stage and stalled
- **Source:** `latest_update_source` → `upsertDocument({ url, status: "done" })`. Every imported figure references that document.
- **`additional_data` keys → field values:**
  | Dataset key(s) | Field | Notes |
  |---|---|---|
  | `initial_capex_usd`, `capex_usd_million`, `stage_1_capex_usd_billion` | `capex_usd` | value text keeps the original wording plus a unit hint, e.g. `"US$450 million"` for `capex_usd_million: 450`; `value_num` in USD |
  | `life_of_project_capex_usd_billion` | `additional_info` | as `"Life-of-project capex: US$X billion"` |
  | `mine_life_years` | `mine_life_years` | value text `"<n> years"`, `value_num` n, unit `"years"` |
  | `daily_processing_capacity_tpd` | `throughput_tpd` | |
  | `reserves_p_and_p`, `reserves_p_and_p_75pct_basis` | `reserve_headline` | the 75% key sets `basis = "attributable"` and `attributable_share = 0.75`, and the value text says "(75% basis)" |
  | `measured_indicated_75pct_basis` | `resource_headline` | same treatment as the 75% reserve key |
  | `avg_annual_cu_production_first_8yrs_t`, `annual_li2co3_production_tonnes` | `annual_production` | |
  | `c1_cash_cost_usd_per_lb` | `c1_cost` | |
  - **Everything else** — `notes`, `process_type`, `npv_after_tax_usd_billion`, `irr_pct`, `ore_processed_total_tonnes`, `total_gold_production_oz`, `annual_ore_processing_tonnes` — is joined into **one** `additional_info` value. The parts are separated by `"; "` and labelled in Title Case, e.g. `"Process: Open-pit…; NPV (after-tax): US$1.2 billion; IRR: 18%; Notes: …"`.
  - All imported figures: `status: "published"` via `publishFieldValue(..., "owner")`, `quote: null`, `confidence: 1`, `figure_date: null`.
- **Idempotency:** if a project already has a published value for a field, the import skips that field. It never supersedes.

- [ ] **Step 1: Write failing tests**
  - Importing the fixture returns `{ created: 3, updated: 0 }`.
  - Vizcachitas: stage `pfs`; published `capex_usd` value text contains `2.4-2.8 billion`; `mine_life_years.value_num === 26`; `additional_info` contains `"Notes:"` and `"Process:"`.
  - Cerro Casale: `reserve_headline.basis === "attributable"` and `attributable_share === 0.75`; `stalled === true`.
  - **Review Focus 4:** importing the fixture a second time returns `{ created: 0, updated: 3 }`, and the count of `field_values` rows is unchanged.
  - Importing the real `data/chile_greenfield_projects.json` creates 17 projects, all with a non-null stage.

- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `importDataset` (a single transaction) and the CLI. The CLI reads `data/chile_greenfield_projects.json`, opens `loadConfig().dbPath`, and prints the counts.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Real run**: `npm run import`. Expected: `created 17`. Then `D:\GreenfieldsData\greenfields.db` exists.
- [ ] **Step 6: Commit**: `feat(import): load existing dataset into SQLite`

---

### Task 5: `db:show` CLI and public data builder

**Files:**
- Create: `src/cli/dbShow.ts`, `src/publish/publicTypes.ts`, `src/publish/buildPublicData.ts`
- Test: `tests/cli/dbShow.test.ts`, `tests/publish/buildPublicData.test.ts`

**Interfaces:**
- Produces:
  - `formatTable(rows: Record<string, unknown>[], maxWidth?: number): string` — box-drawing table, cells truncated to `maxWidth` (default 40) with `…`. Used by `npm run db:show -- <table> [limit]`, which only accepts table names from `sqlite_master`, so arbitrary SQL can't be injected.
  - In `publicTypes.ts` (also imported by the site):
    ```ts
    export interface PublicFigure { field: string; label: string; value: string; unit: string | null;
      basis: "100%" | "attributable"; attributableShare: number | null; figureDate: string | null;
      sourceUrl: string | null; sourceTitle: string | null; quote: string | null; updatedAt: string }
    export interface PublicChange { field: string; label: string; oldValue: string | null; newValue: string; changedAt: string }
    export interface PublicProject { slug: string; name: string; owners: string; minerals: string[]; mineralsText: string;
      region: string; province: string | null; locationDetail: string | null;
      stage: StageCategory; stageLabel: string; stageText: string; stalled: boolean;
      capex: string | null; mineLife: string | null; resourceReserve: string | null; additionalInfo: string | null;
      lastUpdated: string; sourceUrl: string | null; figures: PublicFigure[]; recentChanges: PublicChange[] }
    export interface PublicData { generatedAt: string; projects: PublicProject[] }
    ```
  - `buildPublicData(db, nowIso: string, recentChangeDays: number): PublicData`

**Rules:**
- `minerals` holds the **symbols** (used by the filter); `mineralsText` holds the raw names joined with `", "`.
- `resourceReserve` = the `reserve_headline` value if present, otherwise `resource_headline`, otherwise null.
- `lastUpdated` = the latest `decided_at` among the project's published values.
- `sourceUrl` = the source URL of the most recently decided value.
- `recentChanges` = history within `recentChangeDays`, pairing each published value with the one it superseded (`oldValue`).
- Only `tracking = 'active'` projects are included, sorted by name.

- [ ] **Step 1: Write failing tests**
  - `formatTable([{a:1,b:"x".repeat(50)}])` contains `┌`, and the `b` cell ends with `…`.
  - Using an in-memory DB with the Task 4 fixture imported, `buildPublicData`:
    - returns 3 projects
    - Vizcachitas `capex` contains `"2.4-2.8 billion"` and `minerals` equals `["Cu","Mo","Ag"]`
    - no project's `figures` includes a value whose DB status is `pending`: insert a pending `capex_usd` for Vizcachitas and assert the published one is still shown
    - a project set to `tracking = 'paused'` is excluded
    - after publishing a new `mine_life_years = 30` for Vizcachitas, `recentChanges[0]` is `{ field: "mine_life_years", oldValue: "26 years", newValue: "30 years" }` (the label/format comes from `FIELD_LABELS` and Task 4's value text)

- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** the tests, then `npm run db:show -- projects`. Expected: PASS, and a 17-row table prints.
- [ ] **Step 5: Commit**: `feat(publish): public data builder and db:show CLI`

---

### Task 6: Public site — table logic

**Files:**
- Create: `site/src/tableState.ts`
- Test: `tests/site/tableState.test.ts`

**Interfaces:**
- Consumes: `PublicProject` and `StageCategory`, `STAGE_ORDER` (types/constants from Tasks 3 and 5).
- Produces:
  ```ts
  export type SortKey = "name" | "owners" | "minerals" | "region" | "stage" | "capex" | "mineLife" | "resourceReserve" | "additionalInfo" | "lastUpdated";
  export interface TableQuery { search: string; minerals: string[]; regions: string[]; stages: StageCategory[];
    hideEarlyExploration: boolean; sortKey: SortKey; sortDir: "asc" | "desc" }
  export function applyQuery(projects: PublicProject[], q: TableQuery): PublicProject[]
  export function isRecentlyUpdated(p: PublicProject, nowIso: string, days: number): boolean
  export function distinctValues(projects: PublicProject[]): { minerals: string[]; regions: string[] }
  ```

**Behaviour:**
- `search` matches `name`, `owners` and `additionalInfo`, ignoring case and accents (normalize NFD and strip combining marks).
- Filters on the same facet use OR; filters across facets use AND.
- `hideEarlyExploration` removes `stage === "exploration"`.
- `stage` sorts by `STAGE_ORDER`. `capex` and `mineLife` sort by the number they contain, parsed from the text, with "billion" ×1000 versus "million" for capex.
- Null/missing values always sort last, in both directions.

- [ ] **Step 1: Write failing tests** (with hand-built `PublicProject` fixtures, using a `makeProject(overrides)` helper in the test file)
  - **Review Focus 1:** search `"nueva union"` returns NuevaUnión; search `"VALPARAISO"` does not match (region isn't searched); search `"barrick"` matches via owners.
  - Minerals filter `["Au"]` with stages `["pfs","fs"]` returns only the projects meeting both.
  - `hideEarlyExploration` removes exploration-stage projects.
  - **Review Focus 3:** sorting by `capex` asc and desc keeps the project with `capex: null` last both times; "US$450 million" sorts before "US$2.4-2.8 billion".
  - Sorting by `stage` asc gives exploration before pfs before construction.
  - `isRecentlyUpdated` is true at 6 days and false at 8 days with `days = 7`.

- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `tableState.ts` as pure functions with no DOM.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(site): table filter/sort/search logic`

---

### Task 7: Public site — CSV, page and build

**Files:**
- Create: `site/src/csv.ts`, `site/src/render.ts`, `site/src/main.ts`, `site/index.html`, `site/styles.css`, `src/cli/buildSite.ts`
- Test: `tests/site/csv.test.ts`

**Interfaces:**
- Consumes: `applyQuery`, `isRecentlyUpdated`, `distinctValues` (Task 6); `buildPublicData` (Task 5); `loadConfig` (Task 1).
- Produces:
  - `toCsv(projects: PublicProject[]): string` — UTF-8 BOM, CRLF line endings. Columns in table order: Project, Owner(s), Minerals, Region, Stage, Capex (US$), Mine life, Resource/reserve, Additional info, Last updated, Source. RFC 4180 quoting.
  - `buildSite(db, outDir: string, nowIso: string): { projectsJsonHash: string }` — empties `outDir`, bundles `site/src/main.ts` with esbuild into `outDir/app.js`, copies `index.html` and `styles.css`, and writes `outDir/projects.json`. The hash is SHA-256 of the `projects.json` content **excluding `generatedAt`**, so an unchanged dataset gives the same hash.
  - The `npm run build:site` CLI opens the DB and calls `buildSite(db, config.siteOutDir, new Date().toISOString())`.

**Page (spec §7):**
- **Header:**
  - title "Chilean Greenfield Metal Projects"
  - "Data last updated: <generatedAt formatted in America/New_York, e.g. 28 Oct 2026, 10:04 NY>"
- **Controls:**
  - search box
  - mineral, region and stage multi-selects
  - "Hide early exploration" checkbox
  - "Download CSV" button
- **Table:**
  - the 11 columns
  - clickable headers toggle sort (with an arrow indicator)
  - "Updated" badge when `isRecentlyUpdated(p, now, 7)`
  - Source cell is a link "Source"
  - `—` for null
- **Row click** opens a detail panel (`<dialog>`) with:
  - all `figures` (label, value, basis, plus "Attributable share: 75%" when present, figure date, source link, and the quote in a `<blockquote>` when present)
  - `recentChanges`
  - the full stage text and location detail
- **Footer:**
  - methodology: "Figures are compiled from company investor-relations disclosures, SEIA filings and industry press. Some figures are extracted automatically and may contain errors — always check the linked source."
  - "Not investment advice."
- **Mobile (< 768px):**
  - the table wrapper has `overflow-x: auto`
  - the first column is `position: sticky; left: 0`
  - the controls collapse behind a "Filters" toggle button
- **Theme:** colors as CSS variables, with light and dark via `prefers-color-scheme`.

- [ ] **Step 1: Write failing tests** in `csv.test.ts`
  - The output starts with `"\uFEFF"`, and lines end with `"\r\n"`.
  - **Review Focus 2:** a project with additionalInfo `He said "big", then left\nnext line` and owners `Barrick / Newmont (50/50 JV; inherited)` round-trips: parsing the CSV back with a small RFC 4180 parser in the test returns the exact original strings.
  - Null cells are empty strings, not `—`.
  - `buildSite` into a temp dir with the fixture DB writes `index.html`, `styles.css`, `app.js` and `projects.json`. Calling it twice with different `nowIso` values returns the same `projectsJsonHash`.

- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `csv.ts` and `buildSite.ts`, then `render.ts`/`main.ts`/`index.html`/`styles.css`. `main.ts` fetches `projects.json`, holds a `TableQuery` in memory, and re-renders on change. `render.ts` builds the DOM with `textContent` only, never `innerHTML` with data, so scraped text can't inject markup.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check:**
  1. `npm run build:site && npx wrangler pages dev dist/site`, then open the printed localhost URL.
  2. Check 17 rows, sorting, filters, search "nueva union", CSV download opening in Excel with accents intact, the detail dialog, and the 375 px width (sticky first column, filters toggle).
- [ ] **Step 6: Commit**: `feat(site): public table page, CSV export and site build`

---

### Task 8: Publish to Cloudflare Pages

**Files:**
- Create: `src/publish/publisher.ts`, `src/cli/publish.ts`, `README.md` (replace the stub)
- Test: `tests/publish/publisher.test.ts`

**Interfaces:**
- Consumes: `buildSite` (Task 7), `openDb`, `loadConfig`.
- Produces:
  - `type Deployer = (dir: string, projectName: string) => Promise<void>`
  - `wranglerDeployer: Deployer` — runs `npx wrangler pages deploy <dir> --project-name <name> --branch main --commit-dirty=true` with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from env. It throws if either variable is missing or the exit code ≠ 0, and includes the stderr tail in the error.
  - `publish(db, cfg: AppConfig, deploy: Deployer, opts: { force?: boolean; nowIso: string }): Promise<{ deployed: boolean; hash: string }>`. It builds the site, compares the hash with `meta.last_published_hash`, and skips the deploy if they're equal and not forced. On successful deploy it stores the new hash.
  - CLI `npm run publish [-- --force]` loads `.env` with `process.loadEnvFile()` when present, prints `deployed`/`unchanged` and exits 0; on error it prints the message and exits 1.

- [ ] **Step 1: Write failing tests** (fake deployer that records calls)
  - The first publish calls the deployer once and stores the hash.
  - A second publish with unchanged data doesn't call the deployer → `deployed: false`.
  - `force: true` deploys anyway.
  - After publishing a new field value, the next publish deploys.
  - **Review Focus 5:** with a deployer that throws, `publish` rejects and `meta.last_published_hash` is unchanged, so the next call with a working deployer deploys.
  - `wranglerDeployer` with `CLOUDFLARE_API_TOKEN` unset rejects with a message containing `CLOUDFLARE_API_TOKEN`.

- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `publisher.ts` and the CLI.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Write `README.md`.** It covers:
  - **Purpose:** link to the spec.
  - **Requirements:** Node 24.
  - **Setup:**
    - `npm install`
    - copy `.env.example` to `.env`
    - `npm run import`
  - **Cloudflare one-time setup:**
    1. Create an API token with **Account › Cloudflare Pages › Edit**.
    2. Note the account ID.
    3. Run the first `npm run publish`, which creates the `greenfields` Pages project.
    4. In the dashboard, go to Pages › greenfields › Custom domains › add `greenfields.gabrieltekken.com`.
  - **Commands:** `test`, `import`, `db:show`, `build:site`, `publish`.
  - **Where data lives:** `D:\GreenfieldsData`.

- [ ] **Step 6: Real deploy (with the owner):**
  1. The owner creates the token and fills in `.env`.
  2. Run `npm run publish`. Expected: `deployed`, and a `*.pages.dev` URL works.
  3. The owner adds the custom domain.
  4. Run `npm run publish` again. Expected: `unchanged`.
  5. Open `https://greenfields.gabrieltekken.com` and check that it shows 17 projects.

- [ ] **Step 7: Commit**: `feat(publish): deploy site to Cloudflare Pages with change detection`

---

## Later plans (not part of this plan)

- **Plan 2 — Update pipeline:**
  - sources and watcher
  - reader (HTML/PDF/Playwright)
  - `ModelProvider` interface (Ollama, Workers AI, Claude)
  - triage, extraction, quote verifier, rules
  - scheduler (03:00/10:00 NY, catch-up, gaming guard)
  - runs table, Gmail digest
  - accuracy test set, dry-run mode
  - Task Scheduler setup
- **Plan 3 — Review page and access:**
  - Hono app on 127.0.0.1 with the 5 tabs
  - Access JWT check
  - cloudflared tunnel and Access app setup
- **Plan 4 — Discovery:**
  - SEIA, Cochilco, news and newswire sources
  - candidate extraction, duplicate check, suggestions flow
- **Docker alternative** (Dockerfile + compose + smoke test): at the end of Plan 3, once all runtime pieces exist.
