import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import type { SourceConnector, SourceFetchResult } from '../types.js';

type MetaForgeResponse = {
  data?: unknown[];
  pagination?: {
    totalPages?: number;
    hasNextPage?: boolean;
  };
};

type MetaForgeItem = {
  updated_at?: string;
};

function pickVersion(items: MetaForgeItem[]): string {
  const timestamps = items
    .map((item) => item.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort();

  if (timestamps.length === 0) {
    return 'unknown';
  }

  return timestamps[timestamps.length - 1];
}

export const metaforgeConnector: SourceConnector = {
  sourceId: 'metaforge',
  async fetchRaw(): Promise<SourceFetchResult> {
    const itemsRaw: unknown[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const query = new URLSearchParams({
        limit: String(config.metaforgePageSize),
        page: String(page),
      });
      if (config.metaforgeIncludeComponents) {
        query.set('includeComponents', 'true');
      }

      const url = `${config.metaforgeItemsUrl}?${query.toString()}`;
      const response = await fetchJson<MetaForgeResponse>(url);
      const pageItems = Array.isArray(response.data) ? response.data : [];
      itemsRaw.push(...pageItems);

      totalPages = response.pagination?.totalPages ?? page;
      if (response.pagination?.hasNextPage === false) {
        break;
      }

      page += 1;
    }

    return {
      sourceId: 'metaforge',
      fetchedAt: new Date().toISOString(),
      versionOrCommit: pickVersion(itemsRaw as MetaForgeItem[]),
      itemsRaw,
    };
  },
};
