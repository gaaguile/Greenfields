import { readFileSync } from "node:fs";
import path from "node:path";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import type { AccessSettings } from "../../src/admin/access.ts";
import { createAdminApp, type AdminActions, type AdminDeps } from "../../src/admin/app.ts";
import { loadConfig } from "../../src/config.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import { openDb } from "../../src/store/db.ts";

export const TEAM = "greenfields-test.cloudflareaccess.com";
export const AUD = "aud-tag-123";
export const OWNER = "owner@example.com";
export const ACCESS: AccessSettings = { teamDomain: TEAM, aud: AUD, email: OWNER };
export const ORIGIN = "https://greenfields-admin.example.com";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));

// A key pair made for the test; `jwks` stands in for Cloudflare's published certs.
export async function testKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  // Claims passed in win over the defaults (so a test can sign a wrong audience).
  const sign = (claims: JWTPayload = {}, opts: { expiresIn?: string | number } = {}) =>
    new SignJWT({ email: OWNER, iss: `https://${TEAM}`, aud: AUD, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "1h")
      .sign(privateKey);
  return { jwks, sign };
}

export function fakeActions(): AdminActions & { runs: number; publishes: number } {
  const a = {
    runs: 0,
    publishes: 0,
    runNow: () => { a.runs++; return { started: true }; },
    publishNow: () => { a.publishes++; return { started: true as const }; },
  };
  return a;
}

// An admin app over an in-memory DB holding the small fixture, plus a signed token for the owner.
export async function adminApp(over: Partial<AdminDeps> = {}) {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  const keys = await testKeys();
  const actions = fakeActions();
  const logged: string[] = [];
  const log = { info: () => {}, warn: () => {}, error: (m: string, d?: object) => { logged.push(`${m} ${JSON.stringify(d)}`); } };
  const app = createAdminApp({
    db, cfg: loadConfig({}), access: ACCESS, jwks: keys.jwks, actions, log, now: () => new Date("2026-10-28T15:00:00Z"), ...over,
  });
  const token = await keys.sign();
  const get = (url: string) => app.request(url, { headers: { "cf-access-jwt-assertion": token } });
  const post = (url: string, form: Record<string, string | string[]> = {}, headers: Record<string, string> = {}) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) for (const one of [v].flat()) body.append(k, one);
    return app.request(`${ORIGIN}${url}`, {
      method: "POST",
      body,
      headers: { "cf-access-jwt-assertion": token, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", ...headers },
    });
  };
  return { db, app, keys, token, actions, logged, get, post };
}
