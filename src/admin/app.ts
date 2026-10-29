import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { html } from "hono/html";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { accessMiddleware, type AccessSettings, type AdminEnv } from "./access.ts";
import { sameOriginOnly } from "./forms.ts";
import { page } from "./layout.ts";
import { changesRoutes } from "./tabs/changes.ts";
import { healthRoutes } from "./tabs/health.ts";
import { pendingRoutes } from "./tabs/pending.ts";
import { projectsRoutes } from "./tabs/projects.ts";
import { suggestionsRoutes } from "./tabs/suggestions.ts";

export interface AdminActions {
  runNow(): { started: boolean; reason?: string };
  // Starts a publish in the background; the Health tab shows the outcome.
  publishNow(): { started: true } | { busy: true };
}

export interface AdminDeps {
  db: DatabaseSync;
  cfg: AppConfig;
  access: AccessSettings;
  jwks: JWTVerifyGetKey;
  actions: AdminActions;
  log: Logger;
  now: () => Date;
}

export function createAdminApp(deps: AdminDeps): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  // No other site may frame the page (a framed form would pass the same-origin check), and only this page's
  // own styles and forms are allowed.
  app.use("*", secureHeaders({
    xFrameOptions: "DENY",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      styleSrc: ["'unsafe-inline'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
  }));
  app.get("/healthz", (c) => c.text("ok"));
  app.use("*", accessMiddleware(deps.access, deps.jwks));
  app.use("*", sameOriginOnly());
  app.get("/", (c) => c.redirect("/pending"));
  pendingRoutes(app, deps);
  suggestionsRoutes(app, deps);
  changesRoutes(app, deps);
  projectsRoutes(app, deps);
  healthRoutes(app, deps);
  // A decision on an item someone already decided (two tabs open) is a conflict, not a crash.
  app.onError((err, c) => {
    if (/not pending|not the current value/.test(err.message)) return c.text(err.message, 409);
    deps.log.error("review page error", { path: c.req.path, error: err.stack ?? err.message });
    const body = html`<div class="card"><p class="warn">Something went wrong: ${err.message}</p>
<p>Nothing else was changed. <a href="/pending">Back to the review page</a></p></div>`;
    return c.html(page("Error", "health", body), 500);
  });
  return app;
}
