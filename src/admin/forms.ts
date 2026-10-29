import type { Context, MiddlewareHandler } from "hono";

// Access's login cookie travels with requests from any site, so a button press must come from this page itself.
export function sameOriginOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "POST") return next();
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin") return c.text("Forbidden: request from another site", 403);
    const origin = c.req.header("origin");
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return c.text("Forbidden: bad origin", 403);
      }
      const host = c.req.header("host") ?? new URL(c.req.url).host;
      if (originHost !== host) return c.text("Forbidden: request from another site", 403);
    }
    return next();
  };
}

// Notices are fixed messages chosen by key, so a crafted link cannot put arbitrary text on the page.
export const NOTICES: Record<string, string> = {
  "run-started": "Run started. Refresh this page in a few minutes to see it.",
  "run-busy": "A run is already in progress.",
  "published": "Published: the public site is updated.",
  "publish-unchanged": "Nothing to publish: the public site is already up to date.",
  "publish-busy": "A run is in progress; it will publish when it finishes.",
  "approved": "Approved. Changes go live with Publish now or at the next run.",
  "rejected": "Rejected.",
  "edited": "Edited and approved. Changes go live with Publish now or at the next run.",
  "reverted": "Reverted. Changes go live with Publish now or at the next run.",
  "saved": "Saved. Changes go live with Publish now or at the next run.",
  "source-saved": "Source saved.",
  "source-deleted": "Source removed.",
  "nothing-selected": "Nothing was selected.",
};

export const noticeFrom = (c: Context): string | null => NOTICES[c.req.query("notice") ?? ""] ?? null;

export const backTo = (c: Context, path: string, notice: keyof typeof NOTICES) =>
  c.redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${notice}`, 303);
