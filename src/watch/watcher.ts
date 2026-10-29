import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../log.ts";
import { addFoundDocument } from "../store/documents.ts";
import { recordCheck, type SourceRow } from "../store/sources.ts";
import type { Fetcher } from "./fetcher.ts";
import { discoverLinks, linksFingerprint } from "./links.ts";

export type Renderer = (url: string) => Promise<string>;

// More new links than this in one check means a redesign or a reshuffled archive, not news.
const MAX_NEW_LINKS = 15;

async function loadPage(source: SourceRow, fetcher: Fetcher, render?: Renderer): Promise<string> {
  if (source.render) return render!(source.url);
  const r = await fetcher.get(source.url);
  if (!r.ok) throw new Error(r.error);
  return new TextDecoder().decode(r.body);
}

export async function watchSources(
  db: DatabaseSync,
  fetcher: Fetcher,
  sources: SourceRow[],
  log: Logger,
  nowIso: string,
  opts: { render?: Renderer } = {},
): Promise<{ checked: number; newDocuments: number; failed: number }> {
  let checked = 0;
  let newDocuments = 0;
  let failed = 0;
  const needRender = sources.filter((s) => s.render && !opts.render);
  if (needRender.length) {
    log.warn("skipping sources that need render (playwright not available)", { urls: needRender.map((s) => s.url) });
  }
  // The fetcher limits concurrency and spaces requests per host, so sources can run in parallel.
  await Promise.all(
    sources
      .filter((s) => !s.render || opts.render)
      .map(async (source) => {
        checked++;
        let html: string;
        try {
          html = await loadPage(source, fetcher, opts.render);
        } catch (err) {
          failed++;
          const error = (err as Error).message;
          recordCheck(db, source.id, { ok: false, error, at: nowIso });
          log.warn("source check failed", { url: source.url, error });
          return;
        }
        const links = discoverLinks(html, source.url);
        const fingerprint = linksFingerprint(links);
        let layoutChanged = false;
        if (fingerprint !== source.fingerprint) {
          const known = db.prepare("SELECT 1 FROM documents WHERE url = ?");
          const unseen = links.filter((l) => !known.get(l.url)).length;
          // The first check only records what is already there, so old news is not processed.
          let status: "found" | "skipped" = source.firstCheckedAt ? "found" : "skipped";
          if (status === "found" && unseen > MAX_NEW_LINKS) {
            layoutChanged = true;
            status = "skipped";
            log.warn("too many new links at once; stored as a new baseline", { url: source.url, unseen });
          }
          for (const link of links) {
            const id = addFoundDocument(db, {
              url: link.url, title: link.title, sourceId: source.id, projectId: source.projectId, status,
            });
            if (id !== null && status === "found") newDocuments++;
          }
        }
        recordCheck(db, source.id, { ok: true, fingerprint, linksFound: links.length, at: nowIso, layoutChanged });
        if (links.length === 0) log.warn("source returned no links; its layout may have changed", { url: source.url });
      }),
  );
  return { checked, newDocuments, failed };
}
