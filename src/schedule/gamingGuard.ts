import { execFile } from "node:child_process";
import type { Logger } from "../log.ts";

// GPU load is the only signal; there is no game or process detection.
export type GpuProbe = () => Promise<{ gpuPercent: number | null }>;

export function parseNvidiaSmi(stdout: string): number | null {
  const n = Number.parseInt(stdout.trim().split(/\r?\n/)[0], 10);
  return Number.isFinite(n) ? n : null;
}

// A missing nvidia-smi or a failed read gives null, which counts as "not busy".
export const nvidiaSmiProbe: GpuProbe = () =>
  new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => resolve({ gpuPercent: err ? null : parseNvidiaSmi(stdout) }),
    );
  });

export async function waitForQuietGpu(
  probe: GpuProbe,
  cfg: { gpuBusyPercent: number; postponeMinutes: number },
  deps: { sleep: (ms: number) => Promise<void>; now: () => Date; deadline: Date; log: Logger },
): Promise<{ useFallback: boolean; postponed: boolean }> {
  const wait = cfg.postponeMinutes * 60_000;
  let postponed = false;
  for (;;) {
    const { gpuPercent } = await probe();
    if (gpuPercent === null || gpuPercent <= cfg.gpuBusyPercent) return { useFallback: false, postponed };
    postponed = true;
    if (deps.now().getTime() + wait >= deps.deadline.getTime()) {
      deps.log.info("GPU still busy at the next slot; triage uses the fallback provider", { gpuPercent });
      return { useFallback: true, postponed };
    }
    deps.log.info("GPU busy; triage postponed", { gpuPercent, minutes: cfg.postponeMinutes });
    await deps.sleep(wait);
  }
}
