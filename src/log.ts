import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export interface Logger {
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, data?: object): void;
}

const KEEP_DAYS = 30;
const FILE_RE = /^greenfields-(\d{4}-\d{2}-\d{2})\.log$/;

// en-CA formats dates as YYYY-MM-DD.
const nyDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export function createLogger(dir: string, now: () => Date = () => new Date()): Logger {
  mkdirSync(dir, { recursive: true });
  const cutoff = nyDate(new Date(now().getTime() - KEEP_DAYS * 86_400_000));
  for (const name of readdirSync(dir)) {
    const m = FILE_RE.exec(name);
    if (m && m[1] < cutoff) rmSync(path.join(dir, name), { force: true });
  }
  const write = (level: string, msg: string, data?: object) => {
    const at = now();
    const line = JSON.stringify({ ts: at.toISOString(), level, msg, ...data });
    appendFileSync(path.join(dir, `greenfields-${nyDate(at)}.log`), line + "\n");
    if (level === "error") console.error(line);
    else console.log(line);
  };
  return {
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
  };
}
