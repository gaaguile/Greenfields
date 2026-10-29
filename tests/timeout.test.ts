import { afterEach, describe, expect, it, vi } from "vitest";
import { isTransient } from "../src/pipeline/errors.ts";
import { withTimeout } from "../src/timeout.ts";

describe("withTimeout", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("passes a result through", async () => {
    expect(await withTimeout(Promise.resolve(5), 1000, "x")).toBe(5);
  });

  it("rejects a promise that never settles, as a temporary error", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 60_000, "pdf parse");
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await caught;
    expect((err as Error).message).toBe("pdf parse timed out after 60 s");
    expect(isTransient(err)).toBe(true);
  });
});
