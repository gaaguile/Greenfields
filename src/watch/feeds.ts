import * as cheerio from "cheerio";
import { cleanUrl, type DiscoveredLink } from "./links.ts";

// A feed by its content type, or by its first tag when servers send a generic type.
export function isFeed(contentType: string, body: string): boolean {
  if (/xml|rss|atom/i.test(contentType)) return true;
  const start = body.replace(/^\s*(<\?xml[^>]*\?>\s*)?/i, "").slice(0, 200);
  return /^<(rss|feed)\b/i.test(start);
}

// Items of an RSS feed or entries of an Atom feed. Unlike pages, feeds link to their own articles, so there is
// no same-site filter; the channel's own link is not an item.
export function feedLinks(xml: string, feedUrl: string): DiscoveredLink[] {
  const $ = cheerio.load(xml, { xml: true });
  const base = new URL(feedUrl);
  const seen = new Map<string, DiscoveredLink>();
  const add = (raw: string | undefined, title: string) => {
    const u = raw ? cleanUrl(raw.trim(), base) : null;
    if (u && !seen.has(u.href)) seen.set(u.href, { url: u.href, title: title.replace(/\s+/g, " ").trim() });
  };
  $("item").each((_, el) => {
    const item = $(el);
    add(item.children("link").first().text() || item.children("guid").first().text(), item.children("title").first().text());
  });
  $("entry").each((_, el) => {
    const entry = $(el);
    const link = entry.children('link[rel="alternate"]').first().attr("href") ?? entry.children("link").first().attr("href");
    add(link, entry.children("title").first().text());
  });
  return [...seen.values()];
}
