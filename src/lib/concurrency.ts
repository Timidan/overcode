/**
 * Run `iter` over `items` with at most `limit` promises in flight at any
 * given moment. Results are returned in input order. If `iter` throws for an
 * item, the rejection bubbles up — callers that want partial results should
 * catch inside `iter` and return a sentinel value.
 *
 * Behavior matches the previous local copy in LocalChangesPanel and the
 * unnamed helper in workspace-data.ts so both call sites can share one
 * implementation.
 */
export async function mapConcurrent<I, O>(
  items: I[],
  limit: number,
  iter: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  if (items.length === 0) return [];
  let nextIndex = 0;
  const results = new Array<O>(items.length);
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await iter(items[index], index);
      }
    }),
  );
  return results;
}
