import dotenv from 'dotenv';
import path from 'node:path';
import type { SourceId } from './types.js';

dotenv.config();

const ALL_SOURCES: SourceId[] = ['ardb', 'metaforge', 'raidtheory', 'mahcks'];

function asNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseEnabledSources(raw: string | undefined): SourceId[] {
  if (!raw) {
    return ['ardb', 'metaforge', 'raidtheory'];
  }
  const parsed = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is SourceId => ALL_SOURCES.includes(value as SourceId));

  return parsed.length > 0 ? parsed : ['ardb', 'metaforge', 'raidtheory'];
}

function parseHostAllowList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) {
    return fallback;
  }

  const parsed = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

export const config = {
  port: asNumber(process.env.PORT, 8787),
  cacheTtlMs: asNumber(process.env.CACHE_TTL_MS, 10 * 60 * 1000),
  apiResponseMaxAgeSec: asNumber(process.env.API_RESPONSE_MAX_AGE_SEC, 60),
  requestTimeoutMs: asNumber(process.env.REQUEST_TIMEOUT_MS, 30_000),
  fuzzyMatchThreshold: asNumber(process.env.FUZZY_MATCH_THRESHOLD, 0.93),
  enabledSources: parseEnabledSources(process.env.ENABLED_SOURCES),
  iconProxyEnabled: asBoolean(process.env.ICON_PROXY_ENABLED, true),
  iconAllowedHosts: parseHostAllowList(process.env.ICON_ALLOWED_HOSTS, ['cdn.metaforge.app']),
  iconCacheTtlMs: asNumber(process.env.ICON_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
  iconResponseMaxAgeSec: asNumber(process.env.ICON_RESPONSE_MAX_AGE_SEC, 86400),
  iconSizePx: asNumber(process.env.ICON_SIZE_PX, 96),
  iconTrimThreshold: asNumber(process.env.ICON_TRIM_THRESHOLD, 10),
  iconInnerScale: asNumber(process.env.ICON_INNER_SCALE, 0.86),
  metaforgeDbPath: process.env.METAFORGE_DB_PATH ?? path.resolve(process.cwd(), 'data', 'metaforge.sqlite'),
  metaforgeSyncIntervalMs: asNumber(process.env.METAFORGE_SYNC_INTERVAL_MS, 6 * 60 * 60 * 1000),
  ardbItemsUrl: process.env.ARDB_ITEMS_URL ?? 'https://ardb.app/api/items',
  metaforgeItemsUrl: process.env.METAFORGE_ITEMS_URL ?? 'https://metaforge.app/api/arc-raiders/items',
  metaforgePageSize: asNumber(process.env.METAFORGE_PAGE_SIZE, 100),
  metaforgeIncludeComponents: asBoolean(process.env.METAFORGE_INCLUDE_COMPONENTS, true),
  raidTheoryOwner: process.env.RAIDTHEORY_GITHUB_OWNER ?? 'RaidTheory',
  raidTheoryRepo: process.env.RAIDTHEORY_GITHUB_REPO ?? 'arcraiders-data',
  raidTheoryBranch: process.env.RAIDTHEORY_GITHUB_BRANCH ?? 'main',
  raidTheoryItemsPath: process.env.RAIDTHEORY_ITEMS_PATH ?? 'items',
  raidTheoryConcurrency: asNumber(process.env.RAIDTHEORY_CONCURRENCY, 20),
  raidTheoryMaxItems: asNumber(process.env.RAIDTHEORY_MAX_ITEMS, 0),
  mahcksBaseUrl: process.env.MAHCKS_BASE_URL ?? 'https://arcdata.mahcks.com',
  mahcksPageSize: asNumber(process.env.MAHCKS_PAGE_SIZE, 45),
} as const;
