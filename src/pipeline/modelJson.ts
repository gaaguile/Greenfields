import type { z } from "zod";
import type { ChatJsonRequest, ModelProvider } from "../ai/provider.ts";

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

// Models sometimes wrap JSON in a ```json fence or add a sentence around it.
function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("reply contains no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

function check<T>(schema: z.ZodType<T>, reply: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const parsed = schema.safeParse(extractJson(reply));
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Asks for JSON and validates it; an invalid reply is retried once with the error sent back.
export async function askJson<T>(provider: ModelProvider, schema: z.ZodType<T>, req: ChatJsonRequest): Promise<T> {
  const first = check(schema, await provider.chatJson(req));
  if (first.ok) return first.value;
  const retry = check(
    schema,
    await provider.chatJson({
      ...req,
      user: `${req.user}\n\n---\nYour previous reply was invalid: ${first.error}\nReply again with corrected JSON only.`,
    }),
  );
  if (retry.ok) return retry.value;
  throw new InvalidModelOutputError(`${provider.name}: ${retry.error}`);
}
