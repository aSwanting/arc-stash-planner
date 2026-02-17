import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import type { SourceConnector, SourceFetchResult } from '../types.js';

type MahcksInfo = {
  version?: string;
};

type MahcksPage = {
  items?: unknown[];
  count?: number;
  next?: string | null;
};

export const mahcksConnector: SourceConnector = {
  sourceId: 'mahcks',
  async fetchRaw(): Promise<SourceFetchResult> {
    const apiInfo = await fetchJson<MahcksInfo>(`${config.mahcksBaseUrl}/v1`);

    const itemsRaw: unknown[] = [];
    let offset = 0;

    while (true) {
      const query = new URLSearchParams({
        full: 'true',
        limit: String(config.mahcksPageSize),
        offset: String(offset),
      });

      const pageUrl = `${config.mahcksBaseUrl}/v1/items?${query.toString()}`;
      const page = await fetchJson<MahcksPage>(pageUrl);
      const pageItems = Array.isArray(page.items) ? page.items : [];
      itemsRaw.push(...pageItems);

      if (!page.next || pageItems.length === 0) {
        break;
      }

      offset += config.mahcksPageSize;
    }

    return {
      sourceId: 'mahcks',
      fetchedAt: new Date().toISOString(),
      versionOrCommit: apiInfo.version ? `api-${apiInfo.version}` : 'unknown',
      itemsRaw,
    };
  },
};
