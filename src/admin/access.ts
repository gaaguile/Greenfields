import type { MiddlewareHandler } from "hono";
import { jwtVerify, type JWTVerifyGetKey } from "jose";

// Who may use the review page: Cloudflare Access's team and application, and the owner's email.
// `{ dev: true }` skips the check for trying the page locally; null means not configured (everything refused).
export type AccessSettings = { teamDomain: string; aud: string; email: string } | { dev: true } | null;

export function accessSettings(env: NodeJS.ProcessEnv): AccessSettings {
  if (env.GREENFIELDS_ADMIN_DEV === "1") return { dev: true };
  const { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: aud, ADMIN_EMAIL: email } = env;
  if (!teamDomain || !aud || !email) return null;
  return { teamDomain, aud, email };
}

export const accessCertsUrl = (teamDomain: string) => new URL(`https://${teamDomain}/cdn-cgi/access/certs`);

export type AdminEnv = { Variables: { ownerEmail: string } };

// Cloudflare Access puts a signed token on every request it lets through; the app checks it again,
// so nothing that reaches 127.0.0.1:8787 another way can use the page.
export function accessMiddleware(settings: AccessSettings, jwks: JWTVerifyGetKey): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    if (settings === null) return c.text("Access is not configured", 503);
    if ("dev" in settings) {
      // Dev mode is for this machine only: anything that came through Cloudflare (the tunnel) is refused.
      if (["cf-ray", "cf-connecting-ip", "cf-access-jwt-assertion"].some((h) => c.req.header(h) !== undefined)) {
        return c.text("Forbidden: dev mode only answers on this machine", 403);
      }
      c.set("ownerEmail", "dev");
      return next();
    }
    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) return c.text("Forbidden: no Access token", 403);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `https://${settings.teamDomain}`,
        audience: settings.aud,
        algorithms: ["RS256"],
      });
      const email = typeof payload.email === "string" ? payload.email : "";
      if (email.toLowerCase() !== settings.email.toLowerCase()) return c.text("Forbidden: not the owner", 403);
      c.set("ownerEmail", email);
    } catch {
      return c.text("Forbidden: invalid Access token", 403);
    }
    return next();
  };
}
