import { config } from '../config.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { fetchJson } from '../lib/http.js';
import type { SourceConnector, SourceFetchResult } from '../types.js';

type GitHubCommitResponse = Array<{
  sha?: string;
}>;

type GitHubContentEntry = {
  download_url?: string;
  type?: string;
};

export const raidTheoryConnector: SourceConnector = {
  sourceId: 'raidtheory',
  async fetchRaw(): Promise<SourceFetchResult> {
    const repoBase = `https://api.github.com/repos/${config.raidTheoryOwner}/${config.raidTheoryRepo}`;

    const commitsUrl = `${repoBase}/commits?sha=${encodeURIComponent(config.raidTheoryBranch)}&per_page=1`;
    const latestCommit = await fetchJson<GitHubCommitResponse>(commitsUrl);
    const versionOrCommit = latestCommit[0]?.sha ?? 'unknown';

    const contentsUrl = `${repoBase}/contents/${config.raidTheoryItemsPath}?ref=${encodeURIComponent(config.raidTheoryBranch)}`;
    const entries = await fetchJson<GitHubContentEntry[] | { message?: string }>(contentsUrl);

    if (!Array.isArray(entries)) {
      throw new Error(entries.message ?? 'Unable to fetch RaidTheory items listing');
    }

    const fileUrls = entries
      .filter((entry) => entry.type === 'file' && Boolean(entry.download_url))
      .map((entry) => entry.download_url as string);

    const selectedUrls =
      config.raidTheoryMaxItems > 0 ? fileUrls.slice(0, config.raidTheoryMaxItems) : fileUrls;

    const itemsRaw = await mapWithConcurrency(selectedUrls, config.raidTheoryConcurrency, async (url) => {
      return fetchJson<unknown>(url);
    });

    return {
      sourceId: 'raidtheory',
      fetchedAt: new Date().toISOString(),
      versionOrCommit,
      itemsRaw,
    };
  },
};
