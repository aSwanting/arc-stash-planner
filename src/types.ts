export type SourceId = 'ardb' | 'metaforge' | 'raidtheory' | 'mahcks';

export interface RecipePart {
  itemId?: string;
  name?: string;
  amount: number;
}

export interface SourceItem {
  sourceId: SourceId;
  sourceItemId?: string;
  name?: string;
  type?: string;
  rarity?: string;
  value?: number;
  weight?: number;
  inputs?: RecipePart[];
  outputs?: RecipePart[];
  raw: unknown;
}

export interface FieldDiffers {
  name: boolean;
  type: boolean;
  rarity: boolean;
  value: boolean;
  weight: boolean;
}

export interface DiffReport {
  missingIn: SourceId[];
  fieldDiffers: FieldDiffers;
  recipeDiffers: boolean;
  severity: number;
  explanation: string[];
}

export interface MatchDetail {
  method: 'exact' | 'fuzzy' | 'none';
  confidence: number;
}

export interface CanonicalItem {
  canonicalId: string;
  nameKey: string;
  displayName: string;
  bySource: Partial<Record<SourceId, SourceItem>>;
  matchDetails: Partial<Record<SourceId, MatchDetail>>;
  diffReport: DiffReport;
}

export interface SourceSummary {
  sourceId: SourceId;
  fetchedAt: string;
  versionOrCommit: string;
  itemCount: number;
  error?: string;
}

export interface DiffDataResponse {
  generatedAt: string;
  enabledSources: SourceId[];
  sourceSummaries: SourceSummary[];
  canonicalItems: CanonicalItem[];
}
