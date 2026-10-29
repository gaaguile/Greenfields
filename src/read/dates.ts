import * as cheerio from "cheerio";

// A document's own publication date (news release, technical report, financial report), as YYYY-MM-DD.
// Never the day it was fetched.

const DATELINE_CHARS = 600;
const DAY_MS = 86_400_000;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10,
  nov: 11, dec: 12, enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function ymd(y: number, m: number, d: number, now: Date): string | null {
  const t = Date.UTC(y, m - 1, d);
  const date = new Date(t);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  // A date ahead of today is an announcement of something to come, not when the document was published.
  if (t > now.getTime() + DAY_MS || y < 1990) return null;
  return date.toISOString().slice(0, 10);
}

const isoPrefix = (value: string | undefined, now: Date) => {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim()) : null;
  return m ? ymd(Number(m[1]), Number(m[2]), Number(m[3]), now) : null;
};

export function dateFromHtml(html: string, now: Date): string | null {
  const $ = cheerio.load(html);
  const meta = [
    'meta[property="article:published_time"]', 'meta[name="article:published_time"]', 'meta[itemprop="datePublished"]',
    'meta[name="date"]', 'meta[name="pubdate"]', 'meta[name="publish-date"]', 'meta[name="DC.date.issued"]',
  ];
  for (const sel of meta) {
    const d = isoPrefix($(sel).attr("content"), now);
    if (d) return d;
  }
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const m = /"datePublished"\s*:\s*"([^"]+)"/.exec($(el).text());
    const d = isoPrefix(m?.[1], now);
    if (d) return d;
  }
  const time = $("article time[datetime], main time[datetime], time[datetime]").first().attr("datetime");
  return isoPrefix(time, now);
}

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const DATE_PATTERNS: [RegExp, (m: RegExpExecArray) => [number, number, number]][] = [
  // September 28, 2026 / Sept. 28 2026
  [new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"), (m) => [Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])]],
  // 3 March 2026 / 20 de enero de 2026
  [new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_RE})\\.?,?\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`, "gi"), (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])]],
  // 2026-09-28
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
];

// The dateline of a release sits near the top; dates further down are about other things.
export function dateFromText(text: string, now: Date): string | null {
  const head = text.slice(0, DATELINE_CHARS);
  const found: { at: number; date: string }[] = [];
  for (const [re, parts] of DATE_PATTERNS) {
    for (const m of head.matchAll(re)) {
      const date = ymd(...parts(m as RegExpExecArray), now);
      if (date) found.push({ at: m.index ?? 0, date });
    }
  }
  found.sort((a, b) => a.at - b.at);
  return found[0]?.date ?? null;
}

// Only full year/month/day paths: "/2026/03/" alone says too little.
export function dateFromUrl(url: string): string | null {
  const m = /\/(20\d{2}|19\d{2})\/(\d{2})\/(\d{2})(?:\/|$)/.exec(url);
  return m ? ymd(Number(m[1]), Number(m[2]), Number(m[3]), new Date(8.64e15)) : null;
}

export function documentDate(d: { html: string | null; text: string | null; url: string }, now: Date): string | null {
  return (d.html ? dateFromHtml(d.html, now) : null) ?? (d.text ? dateFromText(d.text, now) : null) ?? dateFromUrl(d.url);
}
