export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(concurrency, values.length || 1));
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: size }, async () => {
    while (nextIndex < values.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(values[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}
