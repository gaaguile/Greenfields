// Gives up on work that never finishes (a malformed PDF, a stuck browser), so one document cannot stall a run.
// The message says "timed out", which the pipeline treats as a temporary error to retry next run.
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
