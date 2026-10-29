import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("defaults the data dir to D:\\GreenfieldsData", () => {
    const cfg = loadConfig({});
    expect(cfg.dataDir).toBe("D:\\GreenfieldsData");
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

describe("loadConfig pipeline settings", () => {
  it("reads the pipeline defaults", () => {
    const cfg = loadConfig({});
    expect(cfg.pipeline.slots).toEqual(["03:00", "10:00"]);
    expect(cfg.pipeline.autoPublishConfidence).toBe(0.8);
    expect(cfg.pipeline.numericChangeThreshold).toBe(0.2);
    expect(cfg.pipeline.triageProvider).toBe("ollama");
    expect(cfg.pipeline.extractProvider).toBe("workersAi");
    expect(cfg.pipeline.triageFallbackProvider).toBe("workersAi");
    expect(cfg.pipeline.digestAfterSlot).toBe("10:00");
    expect(cfg.logDir).toBe(path.join("D:\\GreenfieldsData", "logs"));
  });

  it("fills the Cloudflare account id into provider URLs", () => {
    const cfg = loadConfig({ CLOUDFLARE_ACCOUNT_ID: "acc123" });
    expect(cfg.pipeline.providers.workersAi.baseUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1",
    );
    expect(cfg.pipeline.providers.ollama.kind).toBe("ollama");
  });
});

describe("loadConfig Docker overrides", () => {
  it("lets OLLAMA_BASE_URL point the ollama provider at another host", () => {
    expect(loadConfig({ OLLAMA_BASE_URL: "http://ollama:11434" }).pipeline.providers.ollama.baseUrl).toBe("http://ollama:11434");
    expect(loadConfig({}).pipeline.providers.ollama.baseUrl).toBe("http://127.0.0.1:11434");
  });
});
