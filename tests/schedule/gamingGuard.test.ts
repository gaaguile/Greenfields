import { describe, expect, it } from "vitest";
import type { Logger } from "../../src/log.ts";
import { parseNvidiaSmi, waitForQuietGpu, type GpuProbe } from "../../src/schedule/gamingGuard.ts";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const cfg = { gpuBusyPercent: 30, postponeMinutes: 30 };

function harness(readings: (number | null)[], deadline: string) {
  let clock = new Date("2026-10-28T07:00:00Z").getTime();
  const sleeps: number[] = [];
  const probe: GpuProbe = async () => ({ gpuPercent: readings.length > 1 ? readings.shift()! : readings[0] });
  const deps = {
    sleep: async (ms: number) => { sleeps.push(ms); clock += ms; },
    now: () => new Date(clock),
    deadline: new Date(deadline),
    log,
  };
  return { probe, deps, sleeps };
}

describe("waitForQuietGpu", () => {
  it("does not wait when the GPU is quiet", async () => {
    const h = harness([10], "2026-10-28T14:00:00Z");
    expect(await waitForQuietGpu(h.probe, cfg, h.deps)).toEqual({ useFallback: false, postponed: false });
    expect(h.sleeps).toEqual([]);
  });

  it("waits 30 minutes while the GPU is busy, then goes ahead", async () => {
    const h = harness([80, 10], "2026-10-28T14:00:00Z");
    expect(await waitForQuietGpu(h.probe, cfg, h.deps)).toEqual({ useFallback: false, postponed: true });
    expect(h.sleeps).toEqual([30 * 60_000]);
  });

  it("switches to the fallback provider when the GPU is still busy at the next slot", async () => {
    const h = harness([95], "2026-10-28T08:15:00Z");
    expect(await waitForQuietGpu(h.probe, cfg, h.deps)).toEqual({ useFallback: true, postponed: true });
    expect(h.sleeps).toEqual([30 * 60_000, 30 * 60_000]);
  });

  it("treats a missing GPU reading as quiet", async () => {
    const h = harness([null], "2026-10-28T14:00:00Z");
    expect(await waitForQuietGpu(h.probe, cfg, h.deps)).toEqual({ useFallback: false, postponed: false });
  });
});

describe("parseNvidiaSmi", () => {
  it("reads the first GPU's utilisation", () => {
    expect(parseNvidiaSmi("37\r\n")).toBe(37);
    expect(parseNvidiaSmi("5\n80\n")).toBe(5);
    expect(parseNvidiaSmi("[N/A]")).toBeNull();
  });
});
