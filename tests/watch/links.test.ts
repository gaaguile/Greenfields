import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverLinks, linksFingerprint } from "../../src/watch/links.ts";

const page = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../fixtures/pages", name), "utf8");
const urls = (html: string, url: string) => discoverLinks(html, url).map((l) => l.url);

describe("discoverLinks", () => {
  it("finds Los Andes Copper news items and their PDFs from relative links", () => {
    const found = urls(page("losandescopper-news.html"), "https://losandescopper.com/news/");
    expect(found).toEqual(
      expect.arrayContaining([
        "https://losandescopper.com/news/2026/los-andes-copper-management-change/",
        "https://losandescopper.com/news/2026/los-andes-copper-announces-conversion-of-us-5-million-convertible-debenture/",
        "https://losandescopper.com/site/assets/files/3735/los_andes_-_press_release_-_management_change_-_final_final.pdf",
      ]),
    );
    expect(found).not.toContain("https://losandescopper.com/contact/");
    expect(found).not.toContain("https://losandescopper.com/news/");
  });

  it("finds Rio2 posts and drops social and mailto links", () => {
    const found = urls(page("rio2-news.html"), "https://www.rio2.com/news");
    expect(found).toEqual(
      expect.arrayContaining([
        "https://www.rio2.com/post/rio2-provides-fenix-gold-q3-operations-update",
        "https://www.rio2.com/post/rio2-company-wide-exploration-update",
        "https://www.rio2.com/post/rio2-updates-condestable-mine-resources-reserves",
      ]),
    );
    expect(found.some((u) => u.includes("twitter.com") || u.startsWith("mailto:"))).toBe(false);
    expect(found.some((u) => u.includes("/news/categories/"))).toBe(false);
  });

  it("treats http and www variants of the site as the same site (Teck)", () => {
    const found = urls(page("teck-news-releases.html"), "https://www.teck.com/news/news-releases/");
    expect(found).toEqual(
      expect.arrayContaining([
        "http://www.teck.com/news/news-releases/2026/teck-provides-update-on-highland-valley-copper-operations",
        "http://www.teck.com/news/news-releases/2026/teck-reports-unaudited-second-quarter-results-for-2026",
        "http://www.teck.com/news/news-releases/2025/teck-provides-update-on-chile-operations-maintenance",
      ]),
    );
    expect(found.some((u) => u.includes("/about/contact/") || u.includes("privacy-policy"))).toBe(false);
  });

  it("strips fragments and utm parameters and removes duplicates", () => {
    const html = `<main>
      <a href="/news/a-long-news-title?utm_source=x#top">A long news title here</a>
      <a href="/news/a-long-news-title">A long news title</a>
      <a href="/x">Short</a></main>`;
    expect(discoverLinks(html, "https://x.com/news/")).toEqual([
      { url: "https://x.com/news/a-long-news-title", title: "A long news title here" },
    ]);
  });
});

describe("linksFingerprint", () => {
  it("ignores order", () => {
    const a = [{ url: "https://x.com/1", title: "" }, { url: "https://x.com/2", title: "" }];
    expect(linksFingerprint(a)).toBe(linksFingerprint([...a].reverse()));
    expect(linksFingerprint(a)).not.toBe(linksFingerprint(a.slice(0, 1)));
  });
});
