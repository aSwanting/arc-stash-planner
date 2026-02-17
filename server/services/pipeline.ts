import { config } from '../config.js';
import { getConnectors } from '../connectors/index.js';
import { mergeAndDiffItems } from './matchAndDiff.js';
import { normalizeSourceFetch } from './normalize.js';
import type { DiffDataResponse, SourceId, SourceSummary } from '../types.js';

export async function buildDiffData(enabledSources: SourceId[]): Promise<DiffDataResponse> {
  const connectors = getConnectors(enabledSources);
  const results = await Promise.allSettled(connectors.map((connector) => connector.fetchRaw()));

  const sourceSummaries: SourceSummary[] = [];
  const normalizedBySource: Partial<Record<SourceId, ReturnType<typeof normalizeSourceFetch>>> = {};
  const activeSources: SourceId[] = [];

  for (let index = 0; index < connectors.length; index += 1) {
    const connector = connectors[index];
    const result = results[index];

    if (result.status === 'fulfilled') {
      const normalized = normalizeSourceFetch(result.value);
      normalizedBySource[connector.sourceId] = normalized;
      activeSources.push(connector.sourceId);

      sourceSummaries.push({
        sourceId: connector.sourceId,
        fetchedAt: result.value.fetchedAt,
        versionOrCommit: result.value.versionOrCommit,
        itemCount: normalized.length,
      });
      continue;
    }

    sourceSummaries.push({
      sourceId: connector.sourceId,
      fetchedAt: new Date().toISOString(),
      versionOrCommit: 'unavailable',
      itemCount: 0,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  const canonicalItems = mergeAndDiffItems(normalizedBySource, activeSources, config.fuzzyMatchThreshold);

  return {
    generatedAt: new Date().toISOString(),
    enabledSources: activeSources,
    sourceSummaries,
    canonicalItems,
  };
}
