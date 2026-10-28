import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/log.ts";

describe("createLogger", () => {
  it("writes JSON lines to one file per New York day", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gf-log-"));
    let now = new Date("2026-10-28T15:00:00.000Z");
    const log = createLogger(dir, () => now);
    log.info("first", { a: 1 });
    now = new Date("2026-10-29T15:00:00.000Z");
    log.warn("second");
    // 03:00Z on the 29th is still the 28th in New York.
    now = new Date("2026-10-29T03:00:00.000Z");
    log.error("late");
    const day1 = readFileSync(path.join(dir, "greenfields-2026-10-28.log"), "utf8").trim().split("\n");
    const day2 = readFileSync(path.join(dir, "greenfields-2026-10-29.log"), "utf8").trim().split("\n");
    expect(day1).toHaveLength(2);
    expect(day2).toHaveLength(1);
    expect(JSON.parse(day1[0])).toMatchObject({ ts: "2026-10-28T15:00:00.000Z", level: "info", msg: "first", a: 1 });
    expect(JSON.parse(day2[0])).toMatchObject({ level: "warn", msg: "second" });
  });

  it("deletes log files older than 30 days when created", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gf-log-"));
    const old = path.join(dir, "greenfields-2026-09-01.log");
    const recent = path.join(dir, "greenfields-2026-10-20.log");
    const other = path.join(dir, "notes.txt");
    for (const f of [old, recent, other]) writeFileSync(f, "x");
    createLogger(dir, () => new Date("2026-10-28T15:00:00.000Z"));
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });
});
