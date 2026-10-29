import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { AppConfig } from "../config.ts";
import { accessMiddleware, type AccessSettings, type AdminEnv } from "./access.ts";
import { sameOriginOnly } from "./forms.ts";
import { changesRoutes } from "./tabs/changes.ts";
import { healthRoutes } from "./tabs/health.ts";
import { pendingRoutes } from "./tabs/pending.ts";

export interface AdminActions {
  runNow(): { started: boolean; reason?: string };
  publishNow(): Promise<{ deployed: boolean } | { busy: true }>;
}

export interface AdminDeps {
  db: DatabaseSync;
  cfg: AppConfig;
  access: AccessSettings;
  jwks: JWTVerifyGetKey;
  actions: AdminActions;
  now: () => Date;
}

export function createAdminApp(deps: AdminDeps): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.get("/healthz", (c) => c.text("ok"));
  app.use("*", accessMiddleware(deps.access, deps.jwks));
  app.use("*", sameOriginOnly());
  app.get("/", (c) => c.redirect("/pending"));
  pendingRoutes(app, deps);
  changesRoutes(app, deps);
  healthRoutes(app, deps);
  // A decision on an item someone already decided (two tabs open) is a conflict, not a crash.
  app.onError((err, c) => {
    if (/not pending|not the current value/.test(err.message)) return c.text(err.message, 409);
    throw err;
  });
  return app;
}
