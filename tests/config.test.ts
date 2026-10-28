import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("defaults the data dir to C:\\GreenfieldsData", () => {
    const cfg = loadConfig({});
    expect(cfg.dataDir).toBe("C:\\GreenfieldsData");
    expect(cfg.dbPath).toBe(path.join(cfg.dataDir, "greenfields.db"));
  });

  it("lets GREENFIELDS_DATA_DIR override the data dir", () => {
    const cfg = loadConfig({ GREENFIELDS_DATA_DIR: "D:\\x" });
    expect(cfg.dbPath).toBe(path.join("D:\\x", "greenfields.db"));
  });

  it("reads site and publish settings from config/default.json", () => {
    const cfg = loadConfig({});
    const repoRoot = path.resolve(import.meta.dirname, "..");
    expect(cfg.siteOutDir).toBe(path.join(repoRoot, "dist", "site"));
    expect(cfg.pagesProjectName).toBe("greenfields");
    expect(cfg.recentChangeDays).toBe(7);
    expect(cfg.timezone).toBe("America/New_York");
  });
});
