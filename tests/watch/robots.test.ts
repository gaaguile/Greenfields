import { describe, expect, it } from "vitest";
import { isAllowed } from "../../src/watch/robots.ts";

const UA = "GreenfieldsBot/0.2 (+https://greenfields.gabrieltekken.com)";

describe("isAllowed", () => {
  it("lets a group naming our bot override the * group", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: GreenfieldsBot\nDisallow: /private/\n";
    expect(isAllowed(txt, UA, "https://x.com/news/a")).toBe(true);
    expect(isAllowed(txt, UA, "https://x.com/private/a")).toBe(false);
    expect(isAllowed(txt, "OtherBot/1.0", "https://x.com/news/a")).toBe(false);
  });

  it("uses the longest matching rule, with Allow winning ties", () => {
    const txt = "User-agent: *\nDisallow: /news/\nAllow: /news/2026\n";
    expect(isAllowed(txt, UA, "https://x.com/news/2026/x")).toBe(true);
    expect(isAllowed(txt, UA, "https://x.com/news/2025/x")).toBe(false);
  });

  it("supports * and $ in paths", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$\n";
    expect(isAllowed(txt, UA, "https://x.com/a.pdf")).toBe(false);
    expect(isAllowed(txt, UA, "https://x.com/a.pdf?x=1")).toBe(true);
    expect(isAllowed(txt, UA, "https://x.com/docs/b.pdf")).toBe(false);
  });

  it("allows everything for an empty file or an empty Disallow", () => {
    expect(isAllowed("", UA, "https://x.com/a")).toBe(true);
    expect(isAllowed("User-agent: *\nDisallow:\n", UA, "https://x.com/a")).toBe(true);
  });

  it("ignores comments and groups several user agents", () => {
    const txt = "# hi\nUser-agent: a\nUser-agent: *\nDisallow: /x # no\n";
    expect(isAllowed(txt, UA, "https://x.com/x/1")).toBe(false);
  });
});
