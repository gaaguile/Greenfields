import { describe, expect, it } from "vitest";
import { latestSlot, nextSlot, zonedTimeToUtc } from "../../src/schedule/slots.ts";

const NY = "America/New_York";
const SLOTS = ["03:00", "10:00"];
const iso = (d: Date) => d.toISOString();

describe("zonedTimeToUtc", () => {
  it("converts summer and winter New York times", () => {
    expect(iso(zonedTimeToUtc("2026-07-01", "10:00", NY))).toBe("2026-07-01T14:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-12-01", "10:00", NY))).toBe("2026-12-01T15:00:00.000Z");
  });

  it("handles the daylight-saving change days", () => {
    // Clocks go forward at 02:00 on 8 March and back at 02:00 on 1 November.
    expect(iso(zonedTimeToUtc("2026-03-08", "03:00", NY))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-03-08", "10:00", NY))).toBe("2026-03-08T14:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-11-01", "03:00", NY))).toBe("2026-11-01T08:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-11-01", "10:00", NY))).toBe("2026-11-01T15:00:00.000Z");
  });

  it("moves a time inside the spring-forward gap past the gap", () => {
    expect(iso(zonedTimeToUtc("2026-03-08", "02:30", NY))).toBe("2026-03-08T07:30:00.000Z");
  });
});

describe("nextSlot", () => {
  it("finds the 03:00 slot on the autumn change day", () => {
    expect(nextSlot(new Date("2026-11-01T07:30:00Z"), SLOTS, NY)).toEqual({ at: new Date("2026-11-01T08:00:00Z"), slot: "03:00" });
  });

  it("rolls over to the next day's 03:00 after the 10:00 slot", () => {
    expect(nextSlot(new Date("2026-10-28T14:00:01Z"), SLOTS, NY)).toEqual({ at: new Date("2026-10-29T07:00:00Z"), slot: "03:00" });
  });

  it("is strictly after the given time", () => {
    expect(nextSlot(new Date("2026-10-28T14:00:00Z"), SLOTS, NY).at).toEqual(new Date("2026-10-29T07:00:00Z"));
  });

  it("gives exactly two slots on each change day", () => {
    for (const day of ["2026-03-08", "2026-11-01"]) {
      const start = new Date(`${day}T04:00:00Z`); // just after midnight in New York
      const first = nextSlot(start, SLOTS, NY);
      const second = nextSlot(first.at, SLOTS, NY);
      const third = nextSlot(second.at, SLOTS, NY);
      expect([first.slot, second.slot, third.slot]).toEqual(["03:00", "10:00", "03:00"]);
      expect(third.at.getTime() - first.at.getTime()).toBeGreaterThan(22 * 3600_000);
    }
  });
});

describe("latestSlot", () => {
  it("returns the slot itself at the exact slot instant", () => {
    expect(latestSlot(new Date("2026-10-28T14:00:00Z"), SLOTS, NY)).toEqual({ at: new Date("2026-10-28T14:00:00Z"), slot: "10:00" });
  });

  it("returns the previous day's 10:00 before 03:00", () => {
    expect(latestSlot(new Date("2026-10-28T05:00:00Z"), SLOTS, NY)).toEqual({ at: new Date("2026-10-27T14:00:00Z"), slot: "10:00" });
  });
});
