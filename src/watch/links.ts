import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export interface DiscoveredLink {
  url: string;
  title: string;
}

const MIN_TITLE_CHARS = 12;
const SKIP_CONTAINERS = "nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]";
const SKIP_PATH = /\/(login|signin|sign-in|register|search|cart|account|privacy|cookies?|terms|legal|contact|sitemap)(\/|$)/i;
const SKIP_EXT = /\.(css|js|png|jpe?g|gif|svg|webp|ico|xml|rss|zip|mp4|mp3)$/i;

// Sites link to themselves with and without "www." and over http or https.
const siteKey = (host: string) => host.toLowerCase().replace(/^www\./, "");

function clean(raw: string, base: URL): URL | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
  return u;
}

export function discoverLinks(html: string, pageUrl: string): DiscoveredLink[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const page = clean(pageUrl, base)!.href;
  const seen = new Map<string, DiscoveredLink>();
  $("a[href]").each((_, el) => {
    const a = $(el);
    if (a.closest(SKIP_CONTAINERS).length) return;
    const u = clean(a.attr("href") ?? "", base);
    if (!u || u.href === page) return;
    const isPdf = /\.pdf$/i.test(u.pathname);
    if (!isPdf && siteKey(u.host) !== siteKey(base.host)) return;
    if (SKIP_PATH.test(u.pathname) || SKIP_EXT.test(u.pathname)) return;
    const title = a.text().replace(/\s+/g, " ").trim() || (a.attr("title") ?? "").trim();
    if (!isPdf && title.length < MIN_TITLE_CHARS) return;
    // Keep the longest title seen for a URL (cards often link the same item twice).
    const prev = seen.get(u.href);
    if (!prev || title.length > prev.title.length) seen.set(u.href, { url: u.href, title });
  });
  return [...seen.values()];
}

export function linksFingerprint(links: DiscoveredLink[]): string {
  const urls = links.map((l) => l.url).sort();
  return createHash("sha256").update(urls.join("\n")).digest("hex");
}
