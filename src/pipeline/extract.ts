import { z } from "zod";
import type { ModelProvider } from "../ai/provider.ts";
import { FIELD_LABELS, type FieldKey } from "../domain/fields.ts";
import type { FieldValueRow, ProjectRow } from "../domain/types.ts";
import type { Logger } from "../log.ts";
import { askJson } from "./modelJson.ts";
import { documentMessage } from "./prompts.ts";
import { quoteFound } from "./verify.ts";

const FIELDS = [...(Object.keys(FIELD_LABELS) as FieldKey[]), "stage", "owners", "minerals"] as const;

const figureSchema = z.object({
  field: z.enum(FIELDS),
  valueText: z.string().min(1),
  valueNum: z.number().nullable(),
  unit: z.string().nullable(),
  basis: z.enum(["100%", "attributable"]),
  attributableShare: z.number().min(0).max(1).nullable(),
  figureDate: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  quote: z.string(),
});

const extractSchema = z.object({ figures: z.array(figureSchema) });

export type ProposedFigure = z.infer<typeof figureSchema>;

const SCHEMA_HINT =
  '{"figures": [{"field": one of ' + FIELDS.map((f) => `"${f}"`).join(" | ") + ', "valueText": string, ' +
  '"valueNum": number | null, "unit": string | null, "basis": "100%" | "attributable", ' +
  '"attributableShare": number (0-1) | null, "figureDate": "YYYY-MM-DD" | null, "confidence": number (0-1), ' +
  '"quote": string}]}';

function extractSystem(project: ProjectRow, published: FieldValueRow[]): string {
  const current = published.length
    ? published.map((v) => `- ${v.field}: ${v.valueText}`).join("\n")
    : "- (no published figures yet)";
  return [
    "You extract project figures from a mining company document for a tracker of greenfield projects in Chile.",
    `Project: ${project.name} (slug ${project.slug}). Owners: ${project.owners || "unknown"}. Stage: ${project.stageText || project.stage}.`,
    "Current published record:",
    current,
    `Also report stage, owners or minerals if the document changes them.`,
    "Rules:",
    "- Report only figures stated in the document about this project. Leave out anything you are unsure of.",
    "- quote: copy the exact sentence or phrase from the document that states the figure, word for word.",
    "- Give values on a 100% project basis where the document allows it; otherwise basis \"attributable\" with the share.",
    "- valueText: the figure as a short human-readable string, e.g. \"US$2.7 billion\" or \"26 years\".",
    "- valueNum: US$ amounts in plain dollars (1.2 billion = 1200000000); mine life in years; null if not numeric.",
    "- figureDate: the date the figure is as of, if stated.",
    "- confidence: how sure you are that this is the project's current figure (0-1).",
  ].join("\n");
}

export async function extractFigures(
  provider: ModelProvider,
  doc: { title: string | null; text: string },
  project: ProjectRow,
  published: FieldValueRow[],
  maxChars: number,
  log: Logger,
): Promise<ProposedFigure[]> {
  const { figures } = await askJson(provider, extractSchema, {
    system: extractSystem(project, published),
    user: documentMessage(doc, maxChars),
    schemaHint: SCHEMA_HINT,
  });
  // No figure is kept unless its quote is really in the document.
  return figures.filter((f) => {
    if (quoteFound(f.quote, doc.text)) return true;
    log.warn("quote not found in document; figure dropped", { project: project.slug, field: f.field, quote: f.quote });
    return false;
  });
}
