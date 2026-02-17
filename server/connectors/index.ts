import { ardbConnector } from './ardb.js';
import { mahcksConnector } from './mahcks.js';
import { metaforgeConnector } from './metaforge.js';
import { raidTheoryConnector } from './raidtheory.js';
import type { SourceConnector, SourceId } from '../types.js';

const connectorMap: Record<SourceId, SourceConnector> = {
  ardb: ardbConnector,
  metaforge: metaforgeConnector,
  raidtheory: raidTheoryConnector,
  mahcks: mahcksConnector,
};

export function getConnectors(enabledSources: SourceId[]): SourceConnector[] {
  return enabledSources.map((sourceId) => connectorMap[sourceId]);
}
