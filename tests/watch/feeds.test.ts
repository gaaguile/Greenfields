import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { feedLinks, isFeed } from "../../src/watch/feeds.ts";

const feed = readFileSync(path.resolve(import.meta.dirname, "../fixtures/pages/mch-feed.xml"), "utf8");

describe("feedLinks", () => {
  it("reads the items of a real RSS feed, not the channel's own link", () => {
    const links = feedLinks(feed, "https://www.mch.cl/feed/");
    expect(links).toHaveLength(10);
    expect(links.every((l) => l.url.startsWith("https://www.mch.cl/") && l.url !== "https://www.mch.cl/")).toBe(true);
    expect(links.every((l) => l.title.length > 0)).toBe(true);
  });

  it("reads Atom entries and cleans the links", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>X</title>
      <link href="https://x.com/"/>
      <entry><title>First release</title><link rel="alternate" href="https://x.com/news/1?utm_source=rss#top"/></entry>
      <entry><title>Second release</title><link href="/news/2"/></entry>
      <entry><title>First again</title><link href="https://x.com/news/1"/></entry></feed>`;
    expect(feedLinks(atom, "https://x.com/feed")).toEqual([
      { url: "https://x.com/news/1", title: "First release" },
      { url: "https://x.com/news/2", title: "Second release" },
    ]);
  });
});

describe("isFeed", () => {
  it("recognises feeds by content type or by their first tag", () => {
    expect(isFeed("text/xml;charset=UTF-8", "")).toBe(true);
    expect(isFeed("application/atom+xml", "")).toBe(true);
    expect(isFeed("text/html", "<!doctype html><html>")).toBe(false);
    expect(isFeed("application/octet-stream", '  <?xml version="1.0"?>\n<rss version="2.0">')).toBe(true);
    expect(isFeed("", "<feed xmlns=\"http://www.w3.org/2005/Atom\">")).toBe(true);
  });
});
