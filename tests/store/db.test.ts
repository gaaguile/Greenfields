import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.ts";
import { applySchema } from "../../src/store/schema.ts";

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

  it("records schema_version 1 in meta", () => {
    const db = openDb(":memory:");
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("1");
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare("INSERT INTO field_values (project_id, field, value_text, status) VALUES (999, 'capex_usd', 'x', 'pending')").run(),
    ).toThrow();
  });
});
