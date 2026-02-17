import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import type { SourceConnector, SourceFetchResult } from '../types.js';

type ArdbItem = {
  updatedAt?: string;
};

function pickVersion(items: ArdbItem[]): string {
  const timestamps = items
    .map((item) => item.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  if (timestamps.length === 0) {
    return 'unknown';
  }

  return timestamps[timestamps.length - 1];
}

export const ardbConnector: SourceConnector = {
  sourceId: 'ardb',
  async fetchRaw(): Promise<SourceFetchResult> {
    const data = await fetchJson<unknown>(config.ardbItemsUrl);
    const itemsRaw = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown[] })?.data)
        ? ((data as { data: unknown[] }).data ?? [])
        : [];

    return {
      sourceId: 'ardb',
      fetchedAt: new Date().toISOString(),
      versionOrCommit: pickVersion(itemsRaw as ArdbItem[]),
      itemsRaw,
    };
  },
};
