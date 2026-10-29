import type { ChatJsonRequest, ModelProvider } from "../../src/ai/provider.ts";

// Returns the scripted replies in order and records every request.
export function scriptedProvider(replies: string[]): ModelProvider & { requests: ChatJsonRequest[] } {
  const requests: ChatJsonRequest[] = [];
  return {
    name: "fake",
    requests,
    async chatJson(req) {
      requests.push(req);
      const next = replies.shift();
      if (next === undefined) throw new Error("no scripted reply left");
      return next;
    },
  };
}
