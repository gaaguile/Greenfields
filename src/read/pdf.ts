import { extractText, getDocumentProxy } from "unpdf";

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer it is given, so pass a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.trim()).join("\n\n");
}
