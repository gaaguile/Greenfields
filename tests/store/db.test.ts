import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.ts";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../../src/store/schema.ts";
import { V1_SCHEMA_SQL } from "../fixtures/schemaV1.ts";

describe("openDb", () => {
  it("creates all seven tables", () => {
    const db = openDb(":memory:");
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((r) => r.name);
    for (const t of ["projects", "sources", "documents", "field_values", "suggestions", "runs", "meta"]) {
      expect(names).toContain(t);
    }
  });

  it("can apply the schema twice", () => {
    const db = openDb(":memory:");
    expect(() => applySchema(db)).not.toThrow();
  });

  it("records schema_version 3 in meta", () => {
    const db = openDb(":memory:");
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("3");
  });

  it("migrates a version 1 database to version 3", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(V1_SCHEMA_SQL);
    db.exec("INSERT INTO meta (key, value) VALUES ('schema_version', '1')");
    applySchema(db);
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(version.value).toBe("3");
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("sources")).toEqual(expect.arrayContaining(["render", "last_error", "first_checked_at"]));
    expect(cols("documents")).toEqual(expect.arrayContaining(["project_id", "updated_at"]));
    expect(cols("field_values")).toContain("hold_reason");
    expect(cols("projects")).toContain("report_date");
    expect(() => applySchema(db)).not.toThrow();
  });

  it("waits for a busy database instead of failing at once", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gf-db-"));
    const db = openDb(path.join(dir, "x.db"));
    expect((db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout).toBe(10000);
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare("INSERT INTO field_values (project_id, field, value_text, status) VALUES (999, 'capex_usd', 'x', 'pending')").run(),
    ).toThrow();
  });
});
