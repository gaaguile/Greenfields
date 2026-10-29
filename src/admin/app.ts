import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { html } from "hono/html";
import type { JWTVerifyGetKey } from "jose";
import type { AppConfig } from "../config.ts";
import { accessMiddleware, type AccessSettings, type AdminEnv } from "./access.ts";
import { page } from "./layout.ts";

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
  app.get("/", (c) => c.redirect("/pending"));
  app.get("/pending", (c) => c.html(page("Pending changes", "pending", html`<p class="muted">No changes waiting.</p>`)));
  return app;
}
