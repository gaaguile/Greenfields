import { describe, expect, it } from "vitest";
import { accessSettings } from "../../src/admin/access.ts";
import { loadConfig } from "../../src/config.ts";
import { AUD, OWNER, TEAM, adminApp, testKeys } from "./helpers.ts";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("admin access", () => {
  it("answers /healthz without a token", async () => {
    const { app } = await adminApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("lets the owner in with a valid token", async () => {
    const { get } = await adminApp();
    const res = await get("/pending");
    expect(res.status).toBe(200);
  });

  it("matches the owner's email without regard to case", async () => {
    const { app, keys } = await adminApp();
    const token = await keys.sign({ email: OWNER.toUpperCase() });
    expect((await app.request("/pending", { headers: { "cf-access-jwt-assertion": token } })).status).toBe(200);
  });

  it("refuses requests without a valid owner token", async () => {
    const { app, keys } = await adminApp();
    const other = await testKeys();
    const now = Math.floor(Date.now() / 1000);
    const tokens: (string | null)[] = [
      null,
      await keys.sign({ aud: "someone-else" }),
      await keys.sign({}, { expiresIn: now - 60 }),
      await keys.sign({ email: "intruder@example.com" }),
      await other.sign(),
      `${b64({ alg: "none", typ: "JWT" })}.${b64({ email: OWNER, aud: AUD, iss: `https://${TEAM}`, exp: now + 3600 })}.`,
    ];
    for (const t of tokens) {
      const res = await app.request("/pending", t ? { headers: { "cf-access-jwt-assertion": t } } : {});
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("<html");
    }
  });

  it("refuses everything but /healthz when Access is not configured", async () => {
    const { app } = await adminApp({ access: null });
    const res = await app.request("/pending");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Access is not configured");
    expect((await app.request("/healthz")).status).toBe(200);
  });

  it("skips the check in dev mode", async () => {
    const { app } = await adminApp({ access: { dev: true } });
    expect((await app.request("/pending")).status).toBe(200);
  });

  it("refuses requests that came through Cloudflare in dev mode", async () => {
    const { app } = await adminApp({ access: { dev: true } });
    for (const header of ["cf-ray", "cf-connecting-ip", "cf-access-jwt-assertion"]) {
      const res = await app.request("/pending", { headers: { [header]: "x" } });
      expect(res.status).toBe(403);
    }
  });

  it("redirects / to the pending tab", async () => {
    const { get } = await adminApp();
    const res = await get("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pending");
  });
});

describe("accessSettings", () => {
  it("reads the three settings, or dev mode, or nothing", () => {
    expect(accessSettings({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ADMIN_EMAIL: OWNER })).toEqual({
      teamDomain: TEAM, aud: AUD, email: OWNER,
    });
    expect(accessSettings({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD })).toBeNull();
    expect(accessSettings({ GREENFIELDS_ADMIN_DEV: "1" })).toEqual({ dev: true });
  });
});

describe("admin config", () => {
  it("defaults to 127.0.0.1:8787 and reads overrides", () => {
    expect(loadConfig({}).admin).toEqual({ host: "127.0.0.1", port: 8787 });
    expect(loadConfig({ ADMIN_PORT: "9000", ADMIN_HOST: "0.0.0.0" }).admin).toEqual({ host: "0.0.0.0", port: 9000 });
  });
});

describe("anti-framing headers", () => {
  it("forbids other sites from framing any page", async () => {
    const { get, app } = await adminApp();
    for (const res of [await get("/pending"), await app.request("/pending")]) {
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  });
});
