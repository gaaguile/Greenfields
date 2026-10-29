import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export type TabKey = "pending" | "suggestions" | "projects" | "changes" | "health";
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const TABS: [TabKey, string, string][] = [
  ["pending", "Pending changes", "/pending"],
  ["suggestions", "Suggested projects", "/suggestions"],
  ["projects", "Projects & sources", "/projects"],
  ["changes", "Change log", "/changes"],
  ["health", "Runs & health", "/health"],
];

// Same colour tokens as the public site.
const STYLE = `
:root { --bg:#f7f6f3; --surface:#fff; --text:#1d1d1b; --muted:#66645e; --border:#dddad3; --accent:#b5652b;
  --accent-soft:#f6e7db; --warn:#9a3412; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --surface:#1e1e1c; --text:#ecebe7; --muted:#a3a19a;
  --border:#3a3935; --accent:#e08a4f; --accent-soft:#3b2a1f; --warn:#fdba74; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
header, main { max-width:1200px; margin:0 auto; padding:0 16px; }
header { padding-top:20px; }
h1 { margin:0 0 12px; font-size:1.4rem; }
nav { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid var(--border); margin-bottom:16px; }
nav a { padding:8px 12px; color:var(--muted); text-decoration:none; border-bottom:2px solid transparent; }
nav a.active { color:var(--text); border-color:var(--accent); }
a { color:var(--accent); }
.notice { background:var(--accent-soft); border-radius:6px; padding:8px 12px; margin:0 0 16px; }
.warn { color:var(--warn); font-weight:600; }
.muted { color:var(--muted); }
.card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px 14px; margin:0 0 12px; }
table { width:100%; border-collapse:collapse; background:var(--surface); }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
button, input, select, textarea { font:inherit; }
button { padding:4px 10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
form.inline { display:inline; }
input[type=text], input[type=url], textarea, select { padding:4px 6px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); }
blockquote { margin:6px 0; padding-left:10px; border-left:3px solid var(--border); color:var(--muted); }
`;

export function page(title: string, active: TabKey, body: Html, notice?: string | null): Html {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Greenfields admin</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>Greenfields admin</h1>
<nav>${TABS.map(([key, label, href]) => html`<a href="${href}" class="${key === active ? "active" : ""}">${label}</a>`)}</nav>
</header>
<main>
${notice ? html`<p class="notice">${notice}</p>` : ""}
${body}
</main>
</body>
</html>`;
}

// Links only for http(s); anything else (javascript:, data:) is shown as plain text.
export function link(url: string | null, text?: string | null): Html | string {
  if (!url) return "—";
  return /^https?:\/\//i.test(url) ? html`<a href="${url}" rel="noreferrer noopener" target="_blank">${text || url}</a>` : html`${url}`;
}

// New York time, like the public site.
export function nyTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
}
