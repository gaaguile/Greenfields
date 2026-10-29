import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 3;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  owners TEXT,
  minerals TEXT NOT NULL DEFAULT '[]',
  region TEXT,
  province TEXT,
  location_detail TEXT,
  lat REAL,
  lon REAL,
  stage TEXT,
  stage_text TEXT,
  stalled INTEGER NOT NULL DEFAULT 0,
  tracking TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  company TEXT,
  last_checked_at TEXT,
  fingerprint TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  health TEXT NOT NULL DEFAULT 'ok'
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  source_id INTEGER REFERENCES sources(id),
  title TEXT,
  published_at TEXT,
  fingerprint TEXT,
  text TEXT,
  triage TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_values (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  field TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_num REAL,
  unit TEXT,
  basis TEXT NOT NULL DEFAULT '100%',
  attributable_share REAL,
  figure_date TEXT,
  document_id INTEGER REFERENCES documents(id),
  quote TEXT,
  confidence REAL,
  status TEXT NOT NULL,
  decided_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS field_values_project_field_status ON field_values (project_id, field, status);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  document_ids TEXT NOT NULL DEFAULT '[]',
  duplicate_of INTEGER REFERENCES projects(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  trigger TEXT NOT NULL,
  counts TEXT,
  errors TEXT,
  postponed INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

// Columns added in version 2 (Plan 2: update pipeline).
const V2_SQL = [
  "ALTER TABLE sources ADD COLUMN render INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE sources ADD COLUMN last_error TEXT",
  "ALTER TABLE sources ADD COLUMN first_checked_at TEXT",
  "ALTER TABLE documents ADD COLUMN project_id INTEGER REFERENCES projects(id)",
  "ALTER TABLE documents ADD COLUMN updated_at TEXT",
  "ALTER TABLE documents ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE field_values ADD COLUMN hold_reason TEXT",
];

// Version 3: the latest report date the owner types when no source document gives one.
const V3_SQL = ["ALTER TABLE projects ADD COLUMN report_date TEXT"];

const MIGRATIONS: [number, string[]][] = [[2, V2_SQL], [3, V3_SQL]];

export function applySchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  const version = Number(
    (db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value,
  );
  for (const [target, statements] of MIGRATIONS) {
    if (version >= target) continue;
    db.exec("BEGIN");
    try {
      for (const sql of statements) db.exec(sql);
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(target));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS documents_status ON documents (status)");
}
