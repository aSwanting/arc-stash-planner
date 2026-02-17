import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { metaforgeConnector } from '../connectors/metaforge.js';
import { mergeAndDiffItems } from './matchAndDiff.js';
import { normalizeSourceFetch } from './normalize.js';
import type { DiffDataResponse, SourceFetchResult, SourceSummary } from '../types.js';

interface SyncStateRow {
  last_synced_at: string;
  version: string;
  item_count: number;
}

let dbInstance: DatabaseSync | undefined;

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = config.metaforgeDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS metaforge_items (
      id TEXT PRIMARY KEY,
      name TEXT,
      item_type TEXT,
      rarity TEXT,
      value REAL,
      weight REAL,
      icon TEXT,
      updated_at TEXT,
      cached_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metaforge_item_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      related_item_id TEXT,
      related_name TEXT,
      quantity REAL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES metaforge_items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_metaforge_item_links_item ON metaforge_item_links(item_id);
    CREATE INDEX IF NOT EXISTS idx_metaforge_item_links_relation ON metaforge_item_links(relation);

    CREATE TABLE IF NOT EXISTS metaforge_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_synced_at TEXT NOT NULL,
      version TEXT NOT NULL,
      item_count INTEGER NOT NULL
    );
  `);

  dbInstance = db;
  return db;
}

function getSyncState(db: DatabaseSync): SyncStateRow | undefined {
  const row = db
    .prepare('SELECT last_synced_at, version, item_count FROM metaforge_sync_state WHERE id = 1')
    .get() as SyncStateRow | undefined;
  return row;
}

function extractLinks(item: Record<string, unknown>): Array<{
  relation: string;
  relatedItemId: string | null;
  relatedName: string | null;
  quantity: number | null;
  payloadJson: string;
}> {
  const output: Array<{
    relation: string;
    relatedItemId: string | null;
    relatedName: string | null;
    quantity: number | null;
    payloadJson: string;
  }> = [];

  const push = (
    relation: string,
    entry: unknown,
    relatedItemId: string | null,
    relatedName: string | null,
    quantity: number | null,
  ) => {
    output.push({
      relation,
      relatedItemId,
      relatedName,
      quantity,
      payloadJson: JSON.stringify(entry),
    });
  };

  const components = Array.isArray(item.components) ? item.components : [];
  for (const entry of components) {
    const object = toRecord(entry);
    const nested = toRecord(object?.component);
    push(
      'components',
      entry,
      textOrNull(nested?.id) ?? textOrNull(object?.id),
      textOrNull(nested?.name) ?? textOrNull(object?.name),
      numberOrUndefined(object?.quantity) ?? numberOrUndefined(object?.amount) ?? numberOrUndefined(object?.count) ?? 1,
    );
  }

  const recycleComponents = Array.isArray(item.recycle_components) ? item.recycle_components : [];
  for (const entry of recycleComponents) {
    const object = toRecord(entry);
    const nested = toRecord(object?.component);
    push(
      'recycle_components',
      entry,
      textOrNull(nested?.id) ?? textOrNull(object?.id),
      textOrNull(nested?.name) ?? textOrNull(object?.name),
      numberOrUndefined(object?.quantity) ?? numberOrUndefined(object?.amount) ?? numberOrUndefined(object?.count) ?? 1,
    );
  }

  const recycleFrom = Array.isArray(item.recycle_from) ? item.recycle_from : [];
  for (const entry of recycleFrom) {
    const object = toRecord(entry);
    const nested = toRecord(object?.item);
    push(
      'recycle_from',
      entry,
      textOrNull(nested?.id) ?? textOrNull(object?.id),
      textOrNull(nested?.name) ?? textOrNull(object?.name),
      numberOrUndefined(object?.quantity) ?? numberOrUndefined(object?.amount) ?? numberOrUndefined(object?.count) ?? 1,
    );
  }

  const usedIn = Array.isArray(item.used_in) ? item.used_in : [];
  for (const entry of usedIn) {
    const object = toRecord(entry);
    const nested = toRecord(object?.item);
    push(
      'used_in',
      entry,
      textOrNull(nested?.id) ?? textOrNull(object?.id),
      textOrNull(nested?.name) ?? textOrNull(object?.name),
      numberOrUndefined(object?.quantity) ?? numberOrUndefined(object?.amount) ?? numberOrUndefined(object?.count) ?? 1,
    );
  }

  const soldBy = Array.isArray(item.sold_by) ? item.sold_by : [];
  for (const entry of soldBy) {
    const object = toRecord(entry);
    push(
      'sold_by',
      entry,
      null,
      textOrNull(object?.trader_name) ?? textOrNull(object?.vendor),
      numberOrUndefined(object?.price) ?? null,
    );
  }

  return output;
}

function persistFetchResult(db: DatabaseSync, fetchResult: SourceFetchResult): void {
  const rawItems = fetchResult.itemsRaw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');

  const insertItem = db.prepare(`
    INSERT INTO metaforge_items (
      id, name, item_type, rarity, value, weight, icon, updated_at, cached_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLink = db.prepare(`
    INSERT INTO metaforge_item_links (
      item_id, relation, related_item_id, related_name, quantity, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const writeState = db.prepare(`
    INSERT INTO metaforge_sync_state (id, last_synced_at, version, item_count)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_synced_at = excluded.last_synced_at,
      version = excluded.version,
      item_count = excluded.item_count
  `);

  db.exec('BEGIN;');
  try {
    db.exec('DELETE FROM metaforge_item_links;');
    db.exec('DELETE FROM metaforge_items;');

    for (const item of rawItems) {
      const id = textOrNull(item.id);
      if (!id) {
        continue;
      }

      const statBlock = toRecord(item.stat_block);
      insertItem.run(
        id,
        textOrNull(item.name),
        textOrNull(item.item_type),
        textOrNull(item.rarity),
        numberOrUndefined(item.value) ?? null,
        numberOrUndefined(statBlock?.weight) ?? numberOrUndefined(item.weight) ?? null,
        textOrNull(item.icon),
        textOrNull(item.updated_at),
        fetchResult.fetchedAt,
        JSON.stringify(item),
      );

      const links = extractLinks(item);
      for (const link of links) {
        insertLink.run(id, link.relation, link.relatedItemId, link.relatedName, link.quantity, link.payloadJson);
      }
    }

    writeState.run(fetchResult.fetchedAt, fetchResult.versionOrCommit, rawItems.length);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function readItemsRaw(db: DatabaseSync): unknown[] {
  const rows = db
    .prepare('SELECT raw_json FROM metaforge_items ORDER BY name COLLATE NOCASE ASC')
    .all() as Array<{ raw_json: string }>;

  const output: unknown[] = [];
  for (const row of rows) {
    try {
      output.push(JSON.parse(row.raw_json));
    } catch {
      // Ignore malformed rows.
    }
  }
  return output;
}

async function ensureFreshMetaForgeSnapshot(db: DatabaseSync): Promise<void> {
  const state = getSyncState(db);
  const nowMs = Date.now();
  const stale = !state || nowMs - new Date(state.last_synced_at).getTime() >= config.metaforgeSyncIntervalMs;

  if (!stale) {
    return;
  }

  const fetchResult = await metaforgeConnector.fetchRaw();
  persistFetchResult(db, fetchResult);
}

export async function buildMetaForgeDataFromStore(): Promise<DiffDataResponse> {
  const db = getDb();
  await ensureFreshMetaForgeSnapshot(db);

  const state = getSyncState(db);
  const itemsRaw = readItemsRaw(db);

  const fallbackFetchedAt = state?.last_synced_at ?? new Date().toISOString();
  const resultLike: SourceFetchResult = {
    sourceId: 'metaforge',
    fetchedAt: fallbackFetchedAt,
    versionOrCommit: state?.version ?? 'unknown',
    itemsRaw,
  };

  const normalized = normalizeSourceFetch(resultLike);
  const canonicalItems = mergeAndDiffItems({ metaforge: normalized }, ['metaforge'], config.fuzzyMatchThreshold);

  const summary: SourceSummary = {
    sourceId: 'metaforge',
    fetchedAt: resultLike.fetchedAt,
    versionOrCommit: resultLike.versionOrCommit,
    itemCount: normalized.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    enabledSources: ['metaforge'],
    sourceSummaries: [summary],
    canonicalItems,
  };
}
