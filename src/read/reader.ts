import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../log.ts";
import { isTransient } from "../pipeline/errors.ts";
import { listDocumentsByStatus, recordTransientFailure, setDocumentStatus } from "../store/documents.ts";
import type { Fetcher } from "../watch/fetcher.ts";
import { documentDate } from "./dates.ts";
import { htmlToText } from "./html.ts";
import { pdfToText } from "./pdf.ts";

const isPdf = (url: string, contentType: string) =>
  contentType.toLowerCase().includes("pdf") || /\.pdf$/i.test(new URL(url).pathname);

// Moves each `found` document to `read` (with its text) or `failed` (with the error).
export async function readFoundDocuments(
  db: DatabaseSync,
  fetcher: Fetcher,
  log: Logger,
): Promise<{ read: number; failed: number }> {
  let read = 0;
  let failed = 0;
  await Promise.all(
    listDocumentsByStatus(db, ["found"]).map(async (doc) => {
      try {
        const r = await fetcher.get(doc.url);
        if (!r.ok) throw new Error(r.error);
        let text: string;
        let html: string | null = null;
        let title = doc.title ?? "";
        if (isPdf(doc.url, r.contentType)) {
          text = await pdfToText(r.body);
        } else {
          html = new TextDecoder().decode(r.body);
          const page = htmlToText(html);
          text = page.text;
          title ||= page.title;
        }
        if (!text.trim()) throw new Error("no text found in document");
        const publishedAt = documentDate({ html, text, url: doc.url }, new Date());
        setDocumentStatus(db, doc.id, "read", { text, title, error: null, publishedAt });
        read++;
      } catch (err) {
        const error = (err as Error).message;
        if (isTransient(err) && recordTransientFailure(db, doc.id, error) === "retry") {
          log.warn("document read failed; will retry next run", { url: doc.url, error });
          return;
        }
        setDocumentStatus(db, doc.id, "failed", { error });
        log.warn("document read failed", { url: doc.url, error });
        failed++;
      }
    }),
  );
  return { read, failed };
}
