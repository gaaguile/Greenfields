// Wall-clock slots ("03:00") in a time zone, converted to UTC instants with Intl only.

const DAY_MS = 86_400_000;

// Offset of the zone from UTC at an instant, in ms (New York in winter: -5 h).
function zoneOffset(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// A wall time that falls in a spring-forward gap moves forward by the gap (02:30 becomes 03:30).
export function zonedTimeToUtc(dateYmd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Try the offsets in force a day either side; keep the first that reproduces the wall time.
  const offsets = [zoneOffset(wall - DAY_MS, tz), zoneOffset(wall + DAY_MS, tz)];
  for (const off of offsets) {
    const candidate = wall - off;
    if (zoneOffset(candidate, tz) === off) return new Date(candidate);
  }
  return new Date(wall - offsets[0]);
}

// en-CA formats dates as YYYY-MM-DD.
const zonedDate = (d: Date, tz: string) => d.toLocaleDateString("en-CA", { timeZone: tz });
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function nextSlot(after: Date, slots: string[], tz: string): { at: Date; slot: string } {
  const today = zonedDate(after, tz);
  const sorted = [...slots].sort();
  for (let n = 0; n <= 2; n++) {
    for (const slot of sorted) {
      const at = zonedTimeToUtc(addDays(today, n), slot, tz);
      if (at > after) return { at, slot };
    }
  }
  throw new Error("no slot found");
}

export function latestSlot(atOrBefore: Date, slots: string[], tz: string): { at: Date; slot: string } {
  const today = zonedDate(atOrBefore, tz);
  const sorted = [...slots].sort().reverse();
  for (let n = 0; n >= -2; n--) {
    for (const slot of sorted) {
      const at = zonedTimeToUtc(addDays(today, n), slot, tz);
      if (at <= atOrBefore) return { at, slot };
    }
  }
  throw new Error("no slot found");
}
