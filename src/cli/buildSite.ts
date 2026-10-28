import { loadConfig } from "../config.ts";
import { buildSite } from "../publish/buildSite.ts";
import { openDb } from "../store/db.ts";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const { projectsJsonHash } = await buildSite(db, cfg.siteOutDir, new Date().toISOString(), cfg.recentChangeDays);
console.log(`Site built in ${cfg.siteOutDir} (data hash ${projectsJsonHash.slice(0, 12)})`);
db.close();
