# Greenfields

A public, auto-updated table of greenfield metal projects in Chile (Cu, Au, Ag, Mo and others), published at
`greenfields.gabrieltekken.com`.

- Design: [docs/superpowers/specs/2026-10-28-greenfields-design.md](docs/superpowers/specs/2026-10-28-greenfields-design.md)
- Plans: [docs/superpowers/plans/](docs/superpowers/plans/)

This is Plan 1: the data core and public site. The automatic update pipeline, the review page and discovery come in
later plans.

## Requirements

- Windows 11 (the Docker alternative comes in a later plan)
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

To preview the built site locally:

```bash
python -m http.server 4173 --directory dist/site
```

Then open <http://127.0.0.1:4173>.

## Cloudflare one-time setup

1. In the Cloudflare dashboard, go to **My Profile › API Tokens › Create Token › Custom token**. Give it the
   permission **Account › Cloudflare Pages › Edit**, limited to your account.
2. Copy the token into `.env` as `CLOUDFLARE_API_TOKEN`. Copy your **Account ID** (shown on the account home page)
   into `.env` as `CLOUDFLARE_ACCOUNT_ID`.
3. Run `npm run publish`. The first deploy creates the `greenfields` Pages project and prints a
   `*.pages.dev` address.
4. In **Workers & Pages › greenfields › Custom domains**, add `greenfields.gabrieltekken.com`. Cloudflare creates the
   DNS record because the domain is already on your account.
5. Run `npm run publish` again. It should print `unchanged`.

`.env` is git-ignored and must never be committed.
