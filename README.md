# Greenfields

A public, auto-updated table of greenfield metal projects in Chile (Cu, Au, Ag, Mo and others), published at
`greenfields.gabrieltekken.com`.

- Design: [docs/superpowers/specs/2026-10-28-greenfields-design.md](docs/superpowers/specs/2026-10-28-greenfields-design.md)
- Plans: [docs/superpowers/plans/](docs/superpowers/plans/)

Plans 1–3 are built: the data core, the public site, the automatic update pipeline that checks company news pages
twice a day, and a private review page for held changes. Discovery of new projects (Plan 4) comes later.

## Requirements

- Windows 11 (or Docker on another machine: [docs/docker.md](docs/docker.md))
- Node.js 24 or newer (it has SQLite built in)

## Setup

```bash
npm install
copy .env.example .env
npm run import
```

`npm run import` loads `data/chile_greenfield_projects.json` into the database. It's safe to re-run, because existing
projects are matched by name and published figures are never overwritten.

## Where data lives

The live database is `C:\GreenfieldsData\greenfields.db`. It's kept outside the repo and outside OneDrive, because
OneDrive syncing can corrupt a database while it's being written. To use another folder, set `GREENFIELDS_DATA_DIR` in
`.env`.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Run the automated tests |
| `npm run typecheck` | Check TypeScript types |
| `npm run import` | Import the dataset JSON into the database |
| `npm run db:show -- <table> [limit]` | Print a database table, e.g. `npm run db:show -- projects 20` |
| `npm run build:site` | Build the public site into `dist/site/` |
| `npm run publish` | Build and deploy to Cloudflare Pages if the data changed (`-- --force` deploys anyway) |
| `npm run sources -- list` | List the watched news pages and their health |
| `npm run sources -- sync` | Add the pages in `data/sources.json` to the database |
| `npm run sources -- add <url> --kind ir_news [--project <slug>] [--company <name>] [--render]` | Watch one more page |
| `npm run run-once` | Run the update pipeline once now (`-- --dry-run` uses a copy of the database and never publishes) |
| `npm start` | Run the always-on scheduler (03:00 and 10:00 New York time); normally started by Task Scheduler |
| `npm run eval` | Score the AI models against the hand-checked cases in `eval/` |

To preview the built site locally:

```bash
python -m http.server 4173 --directory dist/site
```

Then open <http://127.0.0.1:4173>.

## Cloudflare one-time setup

1. In the Cloudflare dashboard, go to **My Profile › API Tokens › Create Token › Custom token**. Give it the
   permissions **Account › Cloudflare Pages › Edit** and **Account › Workers AI › Read**, limited to your account.
   (If you already made a Pages-only token, edit it and add Workers AI › Read.)
2. Copy the token into `.env` as `CLOUDFLARE_API_TOKEN`. Copy your **Account ID** (shown on the account home page)
   into `.env` as `CLOUDFLARE_ACCOUNT_ID`.
3. Create the Pages project once (`npm run publish` deploys to it but does not create it):

   ```bash
   npx wrangler pages project create greenfields --production-branch main
   ```

4. Run `npm run publish`. It prints `deployed`, and the site is live at `https://greenfields.pages.dev`.
5. In **Workers & Pages › greenfields › Custom domains**, add `greenfields.gabrieltekken.com`. Cloudflare creates the
   DNS record because the domain is already on your account.
6. Run `npm run publish` again. It should print `unchanged`.

`.env` is git-ignored and must never be committed.

## Update pipeline setup

Each run checks the watched news pages, reads new documents (web pages and PDFs), asks a local AI model whether each
one matters, extracts figures with Workers AI, and keeps a figure only if its quote is found word for word in the
document. Confident small changes are published automatically; the rest wait for review. See the spec, §5.

1. **Ollama (local AI on the GPU).** Install it from <https://ollama.com>, then pull the triage model:

   ```bash
   ollama pull llama3.1:8b
   ```

   Ollama runs in the background and starts with Windows. The pipeline asks it to free video memory 30 seconds
   after use. When the GPU is busy (above 30%, for example during a game), triage waits 30 minutes; if the GPU is
   still busy when the next run is due, that run uses Workers AI instead.
2. **Gmail digest.** In your Google account, create an app password (Security › 2-Step Verification › App
   passwords). Put your address in `.env` as `GMAIL_USER`, the app password as `GMAIL_APP_PASSWORD`, and the address
   that should receive the digest as `DIGEST_TO`. One email is sent after the 10:00 run, and only when something
   needs you: held changes, broken sources, failed documents or run errors.
3. **Sources.** Check `data/sources.json`: one company news page per line, linked to a project or to a company with
   several projects. Then load it:

   ```bash
   npm run sources -- sync
   ```

   The first check of each page only records the news already there; later runs process what is new.

   To find new projects, the list also watches mining news that isn't tied to one company: the Minería Chilena
   feed, Reporte Minero, Cochilco's news page, and Newsfile's mining and metals press-release feed. Each was checked
   for access and robots.txt, but not every site's terms of use could be read, so please check them yourself and
   remove any source whose terms forbid automated reading. Newsfile's feed covers the whole world, so releases that
   never mention Chile are skipped before the AI step. Some sources are left out because they refuse automated
   reading:
   - **SEIA:** its robots.txt forbids all crawling. Add SEIA projects by hand on the review page.
   - **Mining.com, GlobeNewswire and Junior Mining Network:** they answer 403 to the app.
4. **Pages built with JavaScript** (Barrick and Newmont are marked `"render": true`) need a browser engine:

   ```bash
   npx playwright install chromium
   ```

   Without it, those two sources are skipped and the log says so.
5. **Try it.** A dry run works on a copy of the database and never publishes or emails:

   ```bash
   npm run run-once -- --dry-run
   ```

   Then a real run: `npm run run-once`. Logs are in `C:\GreenfieldsData\logs`, one file per day.
6. **Always on.** Register the scheduled task once, from PowerShell opened as administrator in the repo folder:

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
   ```

   It starts `npm start` when Windows starts (logged on or not) and restarts it within a minute if it stops. If the
   computer was off at 03:00 or 10:00, the missed run happens as soon as it starts.

   After pulling new code or changing `.env`, restart it (administrator PowerShell). Stopping the task can leave the
   Node process behind, so the middle command stops any that is still running from the repo folder:

   ```powershell
   Stop-ScheduledTask -TaskName Greenfields
   Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object CommandLine -like '*Greenfields*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   Start-ScheduledTask -TaskName Greenfields
   ```

Optional: to use Claude for extraction, set `ANTHROPIC_API_KEY` in `.env` and change `extractProvider` to `"claude"`
in `config/default.json`. To choose models with evidence, add hand-checked cases as described in
[eval/README.md](eval/README.md) and run `npm run eval`.

## Review page

`npm start` also serves a private review page on `http://127.0.0.1:8787` (this PC only). It has five tabs:

- **Pending changes:** approve, edit and approve, or reject held changes (several at once if you like). Figures from
  news sources (anything but a company's own news page) always wait here, held as "secondary source".
- **Suggested projects:** possible new greenfield projects in Chile found in the news. Nothing is published until you
  decide:
  - **Approve** creates the project, using the details you checked, and offers the company's website as a watched page.
  - **Merge** says it is a project you already track under another name.
  - **Reject** is remembered: that project isn't suggested again.
- **Projects & sources:** edit project details and figures, pause a project, manage the watched pages.
- **Change log:** every published change, with **Revert**.
- **Runs & health:** recent runs, broken sources, failed documents, and **Run now** / **Publish now**.

Approved and edited values go to the public site with **Publish now** or at the next run. To reach the page from
anywhere at `https://greenfields-admin.gabrieltekken.com`, set up Cloudflare Tunnel and Access once:
[docs/admin-setup.md](docs/admin-setup.md). Until `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `ADMIN_EMAIL` are in
`.env`, the page refuses every request.
Plan-1   :  OK
