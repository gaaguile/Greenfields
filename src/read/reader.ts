import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../log.ts";
import { listDocumentsByStatus, setDocumentStatus } from "../store/documents.ts";
import type { Fetcher } from "../watch/fetcher.ts";
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
        let title = doc.title ?? "";
        if (isPdf(doc.url, r.contentType)) {
          text = await pdfToText(r.body);
        } else {
          const html = htmlToText(new TextDecoder().decode(r.body));
          text = html.text;
          title ||= html.title;
        }
        if (!text.trim()) throw new Error("no text found in document");
        setDocumentStatus(db, doc.id, "read", { text, title, error: null });
        read++;
      } catch (err) {
        const error = (err as Error).message;
        setDocumentStatus(db, doc.id, "failed", { error });
        log.warn("document read failed", { url: doc.url, error });
        failed++;
      }
    }),
  );
  return { read, failed };
}
