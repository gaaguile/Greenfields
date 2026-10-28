import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { openDb } from "../store/db.ts";
import { addSource, listSources, syncSourcesFile, type SourceKind } from "../store/sources.ts";
import { formatTable } from "./formatTable.ts";

const USAGE = `Usage:
  npm run sources -- list
  npm run sources -- add <url> --kind ir_news [--project <slug>] [--company <name>] [--render]
  npm run sources -- sync          (reads data/sources.json)`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    kind: { type: "string" },
    project: { type: "string" },
    company: { type: "string" },
    render: { type: "boolean" },
  },
});
const [command, url] = positionals;

const db = openDb(loadConfig().dbPath);
try {
  if (command === "list") {
    const rows = listSources(db).map((s) => ({
      id: s.id, kind: s.kind, url: s.url, project: s.projectId, company: s.company, health: s.health,
      failures: s.failureCount, last_checked: s.lastCheckedAt,
    }));
    console.log(rows.length ? formatTable(rows) : "No sources yet.");
  } else if (command === "add" && url && values.kind) {
    const id = addSource(db, {
      url, kind: values.kind as SourceKind, projectSlug: values.project, company: values.company, render: values.render,
    });
    console.log(`source ${id}: ${url}`);
  } else if (command === "sync") {
    const { added } = syncSourcesFile(db, path.join(REPO_ROOT, "data", "sources.json"));
    console.log(`added ${added} source(s)`);
  } else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
