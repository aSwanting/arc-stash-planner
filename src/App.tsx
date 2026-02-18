import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchMetaForgeDiffData } from './api';
import type { DiffDataResponse, RecipePart, SourceItem } from './types';

interface PlannerItem {
  id: string;
  sourceItemId?: string;
  name: string;
  type?: string;
  rarity?: string;
  value?: number;
  weight?: number;
  level?: number;
  iconUrl?: string;
  baseName: string;
  baseKey: string;
  inputs: RecipePart[];
  raw?: Record<string, unknown>;
}

interface ItemFamily {
  key: string;
  baseName: string;
  variants: PlannerItem[];
}

interface FamilyView {
  family: ItemFamily;
  primaryType: string;
  primaryRarity?: string;
  category: UiCategoryId;
  hasCraftData: boolean;
  hasRecycleData: boolean;
  thumbnailIconUrl?: string;
}

interface RequirementRow {
  key: string;
  itemId?: string;
  name: string;
  amount: number;
}

interface BucketCandidate {
  itemId: string;
  itemName: string;
  itemType?: string;
  isWeapon: boolean;
  isMaterialLike: boolean;
  yield: number;
}

interface RequirementView {
  requirement: RequirementRow;
  requirementItem?: PlannerItem;
  topCandidates: Array<BucketCandidate & { recycleCount: number }>;
}

interface RecycleAggregateView {
  itemId: string;
  itemName: string;
  itemType?: string;
  recycleCount: number;
  covers: string[];
}

interface FocusState {
  kind: 'direct' | 'material' | 'recycler';
  key: string;
}

interface RecycleLinkView {
  key: string;
  itemId?: string;
  name: string;
  type?: string;
  rarity?: string;
  iconUrl?: string;
  quantity: number;
}

interface LoadoutEntry {
  key: string;
  familyKey: string;
  variantId: string;
  quantity: number;
  mode: 'upgrade' | 'craft';
}

interface RequirementListEntry {
  requirement: RequirementRow;
  item?: PlannerItem;
}

type UiCategoryId =
  | 'augments'
  | 'shields'
  | 'weapons'
  | 'ammo'
  | 'weaponMods'
  | 'quickUse'
  | 'keysQuest'
  | 'materials'
  | 'misc';

interface UiCategoryConfig {
  id: UiCategoryId;
  label: string;
  iconUrl: string;
}

const ROMAN_BY_LEVEL = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const;
const LEVEL_BY_ROMAN = new Map<string, number>(
  ROMAN_BY_LEVEL.slice(1).map((roman, index) => [roman, index + 1]),
);

const UI_CATEGORY_CONFIG: UiCategoryConfig[] = [
  { id: 'augments', label: 'Augments', iconUrl: '/stash-icons/icon-augment.png' },
  { id: 'shields', label: 'Shields', iconUrl: '/stash-icons/icon-shield.png' },
  { id: 'weapons', label: 'Weapons', iconUrl: '/stash-icons/icon-weapon.png' },
  { id: 'ammo', label: 'Ammo', iconUrl: '/stash-icons/icon-ammo.png' },
  { id: 'weaponMods', label: 'Weapon Mods', iconUrl: '/stash-icons/icon-weaponmod.png' },
  { id: 'quickUse', label: 'Quick Use', iconUrl: '/stash-icons/icon-quickuse.png' },
  { id: 'keysQuest', label: 'Keys / Quest', iconUrl: '/stash-icons/icon-key.png' },
  { id: 'materials', label: 'Materials', iconUrl: '/stash-icons/icon-material.png' },
  { id: 'misc', label: 'Misc', iconUrl: '/stash-icons/icon-misc.png' },
];

const loadedImageSources = new Set<string>();

interface LazyTileImageProps {
  src: string;
  alt: string;
  isWeapon?: boolean;
}

function LazyTileImage({ src, alt, isWeapon = false }: LazyTileImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(() =>
    loadedImageSources.has(src) ? 'loaded' : 'loading',
  );

  useEffect(() => {
    setStatus(loadedImageSources.has(src) ? 'loaded' : 'loading');
  }, [src]);

  if (status === 'error') {
    return <div className="tile-placeholder" aria-hidden />;
  }

  return (
    <>
      <div className={`tile-loading-overlay ${status === 'loaded' ? 'done' : ''}`} aria-hidden>
        <span className="tile-spinner" />
      </div>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => {
          loadedImageSources.add(src);
          setStatus('loaded');
        }}
        onError={() => setStatus('error')}
        className={['lazy-image', status === 'loaded' ? 'is-loaded' : '', isWeapon ? 'weapon-icon' : '']
          .filter(Boolean)
          .join(' ')}
      />
    </>
  );
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function parseNameLevel(name: string): { baseName: string; level?: number } {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*\S)\s+([IVX]+)$/i);
  if (!match) {
    return { baseName: trimmed };
  }

  const roman = match[2].toUpperCase();
  const level = LEVEL_BY_ROMAN.get(roman);
  if (!level) {
    return { baseName: trimmed };
  }

  return {
    baseName: match[1].trim(),
    level,
  };
}

function formatAmount(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function getMetaForgeItem(item: DiffDataResponse['canonicalItems'][number]): SourceItem | undefined {
  return item.bySource.metaforge;
}

function isWeaponType(type: string | undefined): boolean {
  return normalizeKey(type ?? '').includes('weapon');
}

function isMaterialLikeType(value: string | undefined): boolean {
  const normalized = normalizeKey(value ?? '');
  if (!normalized) {
    return false;
  }
  return normalized.includes('material') || normalized.includes('recyclable') || normalized === 'nature';
}

function isBlueprintType(value: string | undefined): boolean {
  return normalizeKey(value ?? '') === 'blueprint';
}

function isBlueprintName(value: string | undefined): boolean {
  return normalizeKey(value ?? '').includes('blueprint');
}

function categoryFromType(type: string | undefined): UiCategoryId | undefined {
  const normalized = normalizeKey(type ?? '');
  if (normalized === 'cosmetic' || normalized === 'cosmetics' || normalized === 'misc') {
    return undefined;
  }

  if (normalized === 'augment') return 'augments';
  if (normalized === 'shield') return 'shields';
  if (normalized === 'weapon') return 'weapons';
  if (normalized === 'ammunition') return 'ammo';
  if (normalized === 'modification' || normalized === 'mods') return 'weaponMods';
  if (normalized === 'quick use' || normalized === 'throwable' || normalized === 'consumable') return 'quickUse';
  if (normalized === 'key' || normalized === 'quest item') return 'keysQuest';
  if (
    normalized === 'recyclable' ||
    normalized === 'topside material' ||
    normalized === 'refined material' ||
    normalized === 'basic material' ||
    normalized === 'advanced material' ||
    normalized === 'material'
  ) {
    return 'materials';
  }
  if (normalized === 'trinket' || normalized === 'nature' || normalized === 'blueprint' || normalized === 'gadget') {
    return 'misc';
  }

  return 'misc';
}

function rarityClass(value: string | undefined): string {
  const normalized = normalizeKey(value ?? '');
  switch (normalized) {
    case 'common':
      return 'rarity-common';
    case 'uncommon':
      return 'rarity-uncommon';
    case 'rare':
      return 'rarity-rare';
    case 'epic':
      return 'rarity-epic';
    case 'legendary':
      return 'rarity-legendary';
    default:
      return 'rarity-unknown';
  }
}

function rarityRank(value: string | undefined): number {
  const normalized = normalizeKey(value ?? '');
  switch (normalized) {
    case 'legendary':
      return 5;
    case 'epic':
      return 4;
    case 'rare':
      return 3;
    case 'uncommon':
      return 2;
    case 'common':
      return 1;
    default:
      return 0;
  }
}

function tileClassForItem(type: string | undefined, rarity: string | undefined): string {
  return normalizeKey(type ?? '') === 'blueprint' ? 'blueprint' : rarityClass(rarity);
}

function proxyIconUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith('/api/icon?')) {
    return value;
  }
  return `/api/icon?src=${encodeURIComponent(value)}`;
}

function toPlannerItems(data: DiffDataResponse): PlannerItem[] {
  const seen = new Set<string>();
  const output: PlannerItem[] = [];

  for (const canonicalItem of data.canonicalItems) {
    const sourceItem = getMetaForgeItem(canonicalItem);
    if (!sourceItem) {
      continue;
    }

    const resolvedId = (sourceItem.sourceItemId ?? canonicalItem.canonicalId).toLowerCase();
    if (seen.has(resolvedId)) {
      continue;
    }
    seen.add(resolvedId);

    const name = sourceItem.name?.trim() || canonicalItem.displayName;
    const nameParts = parseNameLevel(name);

    output.push({
      id: resolvedId,
      sourceItemId: sourceItem.sourceItemId,
      name,
      type: sourceItem.type,
      rarity: sourceItem.rarity,
      value: sourceItem.value,
      weight: sourceItem.weight,
      level: nameParts.level,
      iconUrl:
        typeof (sourceItem.raw as Record<string, unknown> | undefined)?.icon === 'string'
          ? proxyIconUrl((sourceItem.raw as Record<string, unknown>).icon as string)
          : undefined,
      baseName: nameParts.baseName,
      baseKey: normalizeKey(nameParts.baseName),
      inputs: sourceItem.inputs ?? [],
      raw: sourceItem.raw && typeof sourceItem.raw === 'object' ? (sourceItem.raw as Record<string, unknown>) : undefined,
    });
  }

  output.sort((a, b) => a.name.localeCompare(b.name));
  return output;
}

function toFamilies(items: PlannerItem[]): ItemFamily[] {
  const map = new Map<string, ItemFamily>();

  for (const item of items) {
    const existing = map.get(item.baseKey);
    if (existing) {
      existing.variants.push(item);
      continue;
    }

    map.set(item.baseKey, {
      key: item.baseKey,
      baseName: item.baseName,
      variants: [item],
    });
  }

  const output = Array.from(map.values());

  for (const family of output) {
    family.variants.sort((left, right) => {
      const leftLevel = left.level ?? Number.MAX_SAFE_INTEGER;
      const rightLevel = right.level ?? Number.MAX_SAFE_INTEGER;
      if (leftLevel !== rightLevel) {
        return leftLevel - rightLevel;
      }
      return left.name.localeCompare(right.name);
    });
  }

  output.sort((left, right) => left.baseName.localeCompare(right.baseName));
  return output;
}

function defaultVariantForFamily(family: ItemFamily): PlannerItem | undefined {
  return family.variants.find((variant) => variant.level === 1) ?? family.variants[0];
}

function thumbnailVariantForFamily(family: ItemFamily, category: UiCategoryId): PlannerItem | undefined {
  if (category !== 'weapons') {
    return defaultVariantForFamily(family) ?? family.variants[0];
  }

  const leveled = family.variants
    .filter((variant): variant is PlannerItem & { level: number } => variant.level !== undefined)
    .sort((left, right) => right.level - left.level);

  if (leveled.length === 0) {
    return defaultVariantForFamily(family) ?? family.variants[0];
  }

  return leveled.find((variant) => Boolean(variant.iconUrl)) ?? leveled[0];
}

function variantLabel(item: PlannerItem): string {
  if (item.level && ROMAN_BY_LEVEL[item.level]) {
    return ROMAN_BY_LEVEL[item.level];
  }
  return item.name;
}

function buildUpgradePath(family: ItemFamily | undefined, target: PlannerItem | undefined): PlannerItem[] {
  if (!family || !target) {
    return [];
  }

  const hasLeveledVariants = family.variants.some((variant) => variant.level !== undefined);
  if (!hasLeveledVariants || !target.level) {
    return [target];
  }

  const byLevel = new Map<number, PlannerItem>(
    family.variants
      .filter((variant): variant is PlannerItem & { level: number } => Boolean(variant.level))
      .map((variant) => [variant.level, variant]),
  );

  const startLevel = byLevel.has(1) ? 1 : target.level;
  const path: PlannerItem[] = [];
  for (let level = startLevel; level <= target.level; level += 1) {
    const step = byLevel.get(level);
    if (!step) {
      return [target];
    }
    path.push(step);
  }

  return path.length > 0 ? path : [target];
}

function isInternalFamilyInput(input: RecipePart, familyKey: string, itemById: Map<string, PlannerItem>): boolean {
  const inputId = input.itemId?.toLowerCase();
  if (inputId) {
    const match = itemById.get(inputId);
    if (match && match.baseKey === familyKey) {
      return true;
    }
  }

  if (!input.name) {
    return false;
  }

  return normalizeKey(parseNameLevel(input.name).baseName) === familyKey;
}

function computeUpgradeCraftParts(
  family: ItemFamily | undefined,
  target: PlannerItem | undefined,
  itemById: Map<string, PlannerItem>,
  ignorePart?: (part: RecipePart) => boolean,
): RecipePart[] {
  if (!family || !target) {
    return [];
  }

  const path = buildUpgradePath(family, target);
  const parts: RecipePart[] = [];

  for (const variant of path) {
    for (const input of variant.inputs) {
      if (ignorePart?.(input)) {
        continue;
      }
      if (isInternalFamilyInput(input, family.key, itemById)) {
        continue;
      }
      parts.push(input);
    }
  }

  return parts;
}

function toRequirementRows(parts: RecipePart[]): RequirementRow[] {
  const totals = new Map<string, RequirementRow>();

  for (const part of parts) {
    const key = part.itemId ? part.itemId.toLowerCase() : `name:${normalizeKey(part.name ?? 'unknown')}`;
    const name = part.name ?? part.itemId ?? 'Unknown';
    const itemId = part.itemId;
    const amount = part.amount;

    const existing = totals.get(key);
    if (existing) {
      existing.amount += amount;
      continue;
    }

    totals.set(key, { key, itemId, name, amount });
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (left.amount !== right.amount) {
      return right.amount - left.amount;
    }
    return left.name.localeCompare(right.name);
  });
}

function recycleParts(item: PlannerItem): RecipePart[] {
  const rawParts = item.raw?.recycle_components;
  if (!Array.isArray(rawParts)) {
    return [];
  }

  const output: RecipePart[] = [];
  for (const entry of rawParts) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const part = entry as Record<string, unknown>;
    const component = part.component && typeof part.component === 'object' ? (part.component as Record<string, unknown>) : undefined;

    const amount =
      typeof part.quantity === 'number'
        ? part.quantity
        : typeof part.amount === 'number'
          ? part.amount
          : typeof part.count === 'number'
            ? part.count
            : 1;

    const itemId = typeof component?.id === 'string' ? component.id : undefined;
    const name = typeof component?.name === 'string' ? component.name : undefined;

    if (!itemId && !name) {
      continue;
    }

    output.push({
      itemId,
      name,
      amount,
    });
  }

  return output;
}

function buildRecycleIndex(items: PlannerItem[]): Map<string, BucketCandidate[]> {
  const index = new Map<string, Map<string, BucketCandidate>>();

  for (const item of items) {
    const parts = recycleParts(item);
    for (const part of parts) {
      const key = part.itemId ? part.itemId.toLowerCase() : `name:${normalizeKey(part.name ?? 'unknown')}`;
      const materialBuckets = index.get(key) ?? new Map<string, BucketCandidate>();
      const current = materialBuckets.get(item.id);

      if (current) {
        current.yield += part.amount;
      } else {
        materialBuckets.set(item.id, {
          itemId: item.id,
          itemName: item.name,
          itemType: item.type,
          isWeapon: isWeaponType(item.type),
          isMaterialLike: isMaterialLikeType(item.type),
          yield: part.amount,
        });
      }

      index.set(key, materialBuckets);
    }
  }

  const normalized = new Map<string, BucketCandidate[]>();
  for (const [materialKey, byItem] of index.entries()) {
    const sorted = Array.from(byItem.values()).sort((left, right) => {
      if (left.yield !== right.yield) {
        return right.yield - left.yield;
      }
      return left.itemName.localeCompare(right.itemName);
    });
    normalized.set(materialKey, sorted);
  }

  return normalized;
}

function computeExpandedRequirements(
  target: PlannerItem | undefined,
  itemById: Map<string, PlannerItem>,
  ignorePart?: (part: RecipePart) => boolean,
): RequirementRow[] {
  if (!target) {
    return [];
  }

  const totals = new Map<string, RequirementRow>();

  const add = (key: string, itemId: string | undefined, name: string, amount: number) => {
    if (amount <= 0) {
      return;
    }
    const existing = totals.get(key);
    if (existing) {
      existing.amount += amount;
      return;
    }
    totals.set(key, {
      key,
      itemId,
      name,
      amount,
    });
  };

  const expand = (current: PlannerItem, multiplier: number, stack: Set<string>) => {
    if (current.inputs.length === 0) {
      add(current.id, current.sourceItemId ?? current.id, current.name, multiplier);
      return;
    }

    const nextStack = new Set(stack);
    nextStack.add(current.id);

    for (const input of current.inputs) {
      if (ignorePart?.(input)) {
        continue;
      }

      const amount = input.amount * multiplier;
      const inputId = input.itemId?.toLowerCase();
      const inputName = input.name ?? input.itemId ?? 'Unknown';

      if (!inputId) {
        add(`name:${normalizeKey(inputName)}`, undefined, inputName, amount);
        continue;
      }

      const nextItem = itemById.get(inputId);
      if (!nextItem) {
        add(inputId, input.itemId, inputName, amount);
        continue;
      }

      if (nextStack.has(nextItem.id)) {
        add(nextItem.id, nextItem.sourceItemId ?? nextItem.id, nextItem.name, amount);
        continue;
      }

      if (nextItem.inputs.length === 0) {
        add(nextItem.id, nextItem.sourceItemId ?? nextItem.id, nextItem.name, amount);
        continue;
      }

      expand(nextItem, amount, nextStack);
    }
  };

  expand(target, 1, new Set<string>());

  return Array.from(totals.values()).sort((left, right) => {
    if (left.amount !== right.amount) {
      return right.amount - left.amount;
    }
    return left.name.localeCompare(right.name);
  });
}

function scaleRequirementRows(requirements: RequirementRow[], multiplier: number): RequirementRow[] {
  if (multiplier === 1) {
    return requirements;
  }

  const totals = new Map<string, RequirementRow>();
  for (const requirement of requirements) {
    const existing = totals.get(requirement.key);
    if (existing) {
      existing.amount += requirement.amount * multiplier;
      continue;
    }
    totals.set(requirement.key, {
      ...requirement,
      amount: requirement.amount * multiplier,
    });
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (left.amount !== right.amount) {
      return right.amount - left.amount;
    }
    return left.name.localeCompare(right.name);
  });
}

export default function App() {
  const [data, setData] = useState<DiffDataResponse | null>(null);
  const [activePage, setActivePage] = useState<'database' | 'planner'>('database');
  const [search, setSearch] = useState('');
  const [plannerSearch, setPlannerSearch] = useState('');
  const [plannerRecycleScope, setPlannerRecycleScope] = useState<'materials' | 'withGear'>('materials');
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | undefined>();
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();
  const [loadoutEntries, setLoadoutEntries] = useState<LoadoutEntry[]>([]);
  const [dragOverDropzone, setDragOverDropzone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMetaForgeDiffData();
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const plannerItems = useMemo(() => {
    if (!data) {
      return [];
    }
    return toPlannerItems(data);
  }, [data]);

  const itemById = useMemo(() => {
    return new Map(plannerItems.map((item) => [item.id, item]));
  }, [plannerItems]);

  const itemByName = useMemo(() => {
    const map = new Map<string, PlannerItem[]>();
    for (const item of plannerItems) {
      const key = normalizeKey(item.name);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [plannerItems]);

  const families = useMemo(() => toFamilies(plannerItems), [plannerItems]);
  const familyByKey = useMemo(() => new Map(families.map((family) => [family.key, family])), [families]);
  const recycleIndex = useMemo(() => buildRecycleIndex(plannerItems), [plannerItems]);

  const familyViews = useMemo<FamilyView[]>(() => {
    return families
      .map((family) => {
        const primary = defaultVariantForFamily(family) ?? family.variants[0];
        const primaryType = primary?.type ?? 'Unknown';
        const primaryRarity = primary?.rarity;
        const hasCraftData = family.variants.some((variant) => variant.inputs.length > 0);
        const hasRecycleData = family.variants.some(
          (variant) => Array.isArray(variant.raw?.recycle_components) && variant.raw.recycle_components.length > 0,
        );
        const category = categoryFromType(primaryType);
        if (!category) {
          return undefined;
        }
        const thumbnailVariant = thumbnailVariantForFamily(family, category);

        return {
          family,
          primaryType,
          primaryRarity,
          category,
          hasCraftData,
          hasRecycleData,
          thumbnailIconUrl: thumbnailVariant?.iconUrl,
        };
      })
      .filter((view): view is FamilyView => Boolean(view));
  }, [families]);

  useEffect(() => {
    if (!selectedFamilyKey) {
      return;
    }
    if (!families.some((family) => family.key === selectedFamilyKey)) {
      setSelectedFamilyKey(undefined);
      setSelectedVariantId(undefined);
    }
  }, [families, selectedFamilyKey]);

  const buildGroupedSections = useCallback((query: string) => {
    const normalizedSearch = normalizeKey(query);
    const filtered = familyViews.filter((view) => {
      if (!normalizedSearch) {
        return true;
      }
      if (normalizeKey(view.family.baseName).includes(normalizedSearch)) {
        return true;
      }
      return view.family.variants.some((variant) => normalizeKey(variant.name).includes(normalizedSearch));
    });

    const map = new Map<UiCategoryId, FamilyView[]>();
    for (const view of filtered) {
      const current = map.get(view.category) ?? [];
      current.push(view);
      map.set(view.category, current);
    }

    return UI_CATEGORY_CONFIG.map((config) => ({
      ...config,
      items: (map.get(config.id) ?? []).sort((a, b) => {
        const rarityDiff = rarityRank(b.primaryRarity) - rarityRank(a.primaryRarity);
        if (rarityDiff !== 0) {
          return rarityDiff;
        }
        return a.family.baseName.localeCompare(b.family.baseName);
      }),
    })).filter((section) => section.items.length > 0);
  }, [familyViews]);

  const groupedSections = useMemo(() => buildGroupedSections(search), [buildGroupedSections, search]);
  const plannerGroupedSections = useMemo(() => buildGroupedSections(plannerSearch), [buildGroupedSections, plannerSearch]);

  const selectedFamily = useMemo(() => {
    if (!selectedFamilyKey) {
      return undefined;
    }
    return families.find((family) => family.key === selectedFamilyKey);
  }, [families, selectedFamilyKey]);

  const selectedVariant = useMemo(() => {
    if (!selectedVariantId || !selectedFamily) {
      return undefined;
    }
    return selectedFamily.variants.find((variant) => variant.id === selectedVariantId);
  }, [selectedFamily, selectedVariantId]);

  const showLevelSelector = useMemo(() => {
    if (!selectedFamily) {
      return false;
    }
    return selectedFamily.variants.length > 1 && selectedFamily.variants.some((variant) => variant.level !== undefined);
  }, [selectedFamily]);

  useEffect(() => {
    if (!selectedFamily) {
      if (selectedVariantId !== undefined) {
        setSelectedVariantId(undefined);
      }
      return;
    }
    if (!selectedVariantId || !selectedFamily.variants.some((variant) => variant.id === selectedVariantId)) {
      setSelectedVariantId(defaultVariantForFamily(selectedFamily)?.id);
    }
  }, [selectedFamily, selectedVariantId]);

  const isBlueprintPart = useCallback(
    (part: RecipePart): boolean => {
      const byId = part.itemId ? itemById.get(part.itemId.toLowerCase()) : undefined;
      if (byId) {
        return isBlueprintType(byId.type) || isBlueprintName(byId.name);
      }
      const byName = part.name ? itemByName.get(normalizeKey(part.name))?.[0] : undefined;
      if (byName) {
        return isBlueprintType(byName.type) || isBlueprintName(byName.name);
      }
      return isBlueprintName(part.name);
    },
    [itemById, itemByName],
  );

  const closeDbPanel = useCallback(() => {
    setSelectedFamilyKey(undefined);
    setSelectedVariantId(undefined);
  }, []);

  useEffect(() => {
    if (!selectedFamily || activePage !== 'database') {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDbPanel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedFamily, activePage, closeDbPanel]);

  const onSelectFamily = useCallback((family: ItemFamily) => {
    if (selectedFamilyKey === family.key) {
      closeDbPanel();
      return;
    }
    setSelectedFamilyKey(family.key);
    setSelectedVariantId(defaultVariantForFamily(family)?.id);
  }, [selectedFamilyKey, closeDbPanel]);

  useEffect(() => {
    setLoadoutEntries((previous) => {
      const next = previous.filter((entry) => {
        const family = familyByKey.get(entry.familyKey);
        if (!family) {
          return false;
        }
        return family.variants.some((variant) => variant.id === entry.variantId);
      });
      return next.length === previous.length ? previous : next;
    });
  }, [familyByKey]);

  const addFamilyToLoadout = useCallback((familyKey: string) => {
    const family = familyByKey.get(familyKey);
    if (!family) {
      return;
    }
    const variant = defaultVariantForFamily(family) ?? family.variants[0];
    if (!variant) {
      return;
    }

    setLoadoutEntries((previous) => {
      const existing = previous.find((entry) => entry.variantId === variant.id && entry.mode === 'craft');
      if (existing) {
        return previous.map((entry) =>
          entry.key === existing.key ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }
      return [
        ...previous,
        {
          key: `${family.key}:${variant.id}:${Date.now()}`,
          familyKey: family.key,
          variantId: variant.id,
          quantity: 1,
          mode: 'craft',
        },
      ];
    });
  }, [familyByKey]);

  const resolvedLoadout = useMemo(() => {
    return loadoutEntries
      .map((entry) => {
        const family = familyByKey.get(entry.familyKey);
        if (!family) {
          return undefined;
        }
        const variant = family.variants.find((item) => item.id === entry.variantId) ?? defaultVariantForFamily(family) ?? family.variants[0];
        if (!variant) {
          return undefined;
        }
        return { entry, family, variant };
      })
      .filter((row): row is { entry: LoadoutEntry; family: ItemFamily; variant: PlannerItem } => Boolean(row));
  }, [loadoutEntries, familyByKey]);

  const mergeRows = useCallback((rows: RequirementRow[]): RequirementRow[] => {
    const totals = new Map<string, RequirementRow>();
    for (const row of rows) {
      const existing = totals.get(row.key);
      if (existing) {
        existing.amount += row.amount;
        continue;
      }
      totals.set(row.key, { ...row });
    }
    return Array.from(totals.values()).sort((left, right) => {
      if (left.amount !== right.amount) {
        return right.amount - left.amount;
      }
      return left.name.localeCompare(right.name);
    });
  }, []);

  const directTotals = useMemo<RequirementRow[]>(() => {
    const allRows: RequirementRow[] = [];

    for (const row of resolvedLoadout) {
      const parts =
        row.entry.mode === 'upgrade'
          ? row.variant.inputs.filter((input) => !isBlueprintPart(input))
          : computeUpgradeCraftParts(row.family, row.variant, itemById, isBlueprintPart);
      const direct = toRequirementRows(parts);
      allRows.push(...scaleRequirementRows(direct, row.entry.quantity));
    }

    return mergeRows(allRows);
  }, [resolvedLoadout, isBlueprintPart, itemById, mergeRows]);

  const baseTotals = useMemo<RequirementRow[]>(() => {
    const allRows: RequirementRow[] = [];

    for (const requirement of directTotals) {
      const requirementItem =
        (requirement.itemId ? itemById.get(requirement.itemId.toLowerCase()) : undefined) ??
        itemByName.get(normalizeKey(requirement.name))?.[0];

      if (!requirementItem) {
        allRows.push(requirement);
        continue;
      }

      const expanded = computeExpandedRequirements(requirementItem, itemById, isBlueprintPart);
      if (expanded.length === 0) {
        allRows.push(requirement);
        continue;
      }

      allRows.push(...scaleRequirementRows(expanded, requirement.amount));
    }

    return mergeRows(allRows);
  }, [directTotals, itemById, itemByName, isBlueprintPart, mergeRows]);

  const directTotalViews = useMemo<RequirementListEntry[]>(() => {
    return directTotals.map((requirement) => ({
      requirement,
      item:
        (requirement.itemId ? itemById.get(requirement.itemId.toLowerCase()) : undefined) ??
        itemByName.get(normalizeKey(requirement.name))?.[0],
    }));
  }, [directTotals, itemById, itemByName]);

  const baseTotalViews = useMemo<RequirementListEntry[]>(() => {
    return baseTotals.map((requirement) => ({
      requirement,
      item:
        (requirement.itemId ? itemById.get(requirement.itemId.toLowerCase()) : undefined) ??
        itemByName.get(normalizeKey(requirement.name))?.[0],
    }));
  }, [baseTotals, itemById, itemByName]);

  const recyclerPlan = useMemo<RecycleAggregateView[]>(() => {
    const totals = new Map<string, RecycleAggregateView>();

    for (const requirement of baseTotals) {
      const bucketKey = requirement.itemId ? requirement.itemId.toLowerCase() : `name:${normalizeKey(requirement.name)}`;
      const candidates = recycleIndex.get(bucketKey) ?? [];
      const scoped = plannerRecycleScope === 'materials' ? candidates.filter((candidate) => candidate.isMaterialLike) : candidates;
      const best = scoped[0];
      if (!best) {
        continue;
      }

      const recycleCount = Math.ceil(requirement.amount / best.yield);
      const existing = totals.get(best.itemId);
      if (existing) {
        existing.recycleCount += recycleCount;
        if (!existing.covers.includes(requirement.name)) {
          existing.covers.push(requirement.name);
        }
        continue;
      }

      totals.set(best.itemId, {
        itemId: best.itemId,
        itemName: best.itemName,
        itemType: best.itemType,
        recycleCount,
        covers: [requirement.name],
      });
    }

    return Array.from(totals.values()).sort((left, right) => {
      if (left.recycleCount !== right.recycleCount) {
        return right.recycleCount - left.recycleCount;
      }
      return left.itemName.localeCompare(right.itemName);
    });
  }, [baseTotals, recycleIndex, plannerRecycleScope]);

  const applyDropFamily = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOverDropzone(false);
    const familyKey = event.dataTransfer.getData('application/x-arc-family-key') || event.dataTransfer.getData('text/plain');
    if (!familyKey) {
      return;
    }
    addFamilyToLoadout(familyKey);
  }, [addFamilyToLoadout]);

  return (
    <div className={`app-root ${activePage === 'database' && selectedFamily ? 'panel-open' : ''}`}>
      <header className="header-shell">
        <div className="header-top">
          <div className="arc-logo-block" aria-hidden>
            <span className="arc-logo-stripes" />
          </div>
          <div className="header-title-wrap">
            <div className="header-title">ARC Data Explorer</div>
            <div className="header-subtitle">
              {activePage === 'database' ? 'Browse item database' : 'Build loadouts and aggregate craft requirements'}
            </div>
          </div>
        </div>
        <div className="header-row view-tabs" role="tablist" aria-label="App pages">
          <button
            type="button"
            role="tab"
            aria-selected={activePage === 'database'}
            className={`view-tab ${activePage === 'database' ? 'active' : ''}`}
            onClick={() => setActivePage('database')}
          >
            Database
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePage === 'planner'}
            className={`view-tab ${activePage === 'planner' ? 'active' : ''}`}
            onClick={() => setActivePage('planner')}
          >
            Planner
          </button>
        </div>
        <div className="header-row">
          <input
            className="search-input"
            type="text"
            value={activePage === 'database' ? search : plannerSearch}
            placeholder={activePage === 'database' ? 'Type to filter squares...' : 'Filter planner library...'}
            onChange={(event) => {
              if (activePage === 'database') {
                setSearch(event.target.value);
              } else {
                setPlannerSearch(event.target.value);
              }
            }}
          />
        </div>
        <div className="header-meta">
          {loading ? 'Loading...' : 'Ready'} | Families: {familyViews.length}
          {activePage === 'planner' ? ` | Loadout items: ${resolvedLoadout.length}` : ''}
          {data ? ` | Updated: ${new Date(data.generatedAt).toLocaleString()}` : ''}
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      {activePage === 'database' ? (
        <>
          <div className="main-layout">
            <div className="grid-shell">
              {groupedSections.map((section) => (
                <section key={section.id} className="category-block">
                  <div className="category-head">
                    <span className="category-head-main">
                      <img className="category-head-icon" src={section.iconUrl} alt="" aria-hidden />
                      <span>{section.label}</span>
                    </span>
                    <span>{section.items.length}</span>
                  </div>
                  <div className="square-grid">
                    {section.items.map((view) => {
                      const isSelected = selectedFamily?.key === view.family.key;
                      const tileClasses = ['item-tile', tileClassForItem(view.primaryType, view.primaryRarity), isSelected ? 'selected' : '']
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <button
                          key={view.family.key}
                          type="button"
                          className={tileClasses}
                          onClick={() => onSelectFamily(view.family)}
                          title={view.family.baseName}
                          aria-label={view.family.baseName}
                        >
                          <div className="item-thumb">
                            {view.thumbnailIconUrl ? (
                              <LazyTileImage
                                src={view.thumbnailIconUrl}
                                alt={view.family.baseName}
                                isWeapon={isWeaponType(view.primaryType)}
                              />
                            ) : (
                              <div className="tile-placeholder" aria-hidden />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groupedSections.length === 0 ? <div className="empty-grid">No families match filters.</div> : null}
            </div>
          </div>

          {selectedFamily ? <button type="button" className="panel-backdrop" onClick={closeDbPanel} aria-label="Close details" /> : null}

          <aside className={`side-panel ${selectedFamily ? 'open' : ''}`} aria-hidden={!selectedFamily}>
            {selectedFamily ? (
              <>
                <div className="panel-head">
                  <div className="panel-title">{selectedFamily.baseName}</div>
                  <button type="button" className="panel-close-minimal" onClick={closeDbPanel} aria-label="Close details">
                    ×
                  </button>
                </div>

                {showLevelSelector ? (
                  <div className="square-row">
                    {selectedFamily.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        className={`mini-square ${variant.id === selectedVariant?.id ? 'selected' : ''}`}
                        onClick={() => setSelectedVariantId(variant.id)}
                      >
                        {variantLabel(variant)}
                      </button>
                    ))}
                  </div>
                ) : null}

                {selectedVariant ? (
                  <div className="panel-section">
                    <div className="section-head">Item Info</div>
                    <div className="info-chip-row">
                      {selectedVariant.type ? (
                        <div className="info-chip">
                          <span className="info-chip-label">Type</span>
                          <span className="info-chip-value">{selectedVariant.type}</span>
                        </div>
                      ) : null}
                      {selectedVariant.rarity ? (
                        <div className="info-chip">
                          <span className="info-chip-label">Rarity</span>
                          <span className="info-chip-value">{selectedVariant.rarity}</span>
                        </div>
                      ) : null}
                      {selectedVariant.value !== undefined ? (
                        <div className="info-chip">
                          <span className="info-chip-label">Value</span>
                          <span className="info-chip-value">{formatAmount(selectedVariant.value)}</span>
                        </div>
                      ) : null}
                      {selectedVariant.weight !== undefined ? (
                        <div className="info-chip">
                          <span className="info-chip-label">Weight</span>
                          <span className="info-chip-value">{formatAmount(selectedVariant.weight)}</span>
                        </div>
                      ) : null}
                      <div className="info-chip">
                        <span className="info-chip-label">Direct Inputs</span>
                        <span className="info-chip-value">{selectedVariant.inputs.length}</span>
                      </div>
                      <div className="info-chip">
                        <span className="info-chip-label">Recycle Outputs</span>
                        <span className="info-chip-value">{recycleParts(selectedVariant).length}</span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </aside>
        </>
      ) : (
        <div className="planner-layout">
          <div className="planner-library">
            {plannerGroupedSections.map((section) => (
              <section key={`planner-${section.id}`} className="category-block planner-category-block">
                <div className="category-head">
                  <span className="category-head-main">
                    <img className="category-head-icon" src={section.iconUrl} alt="" aria-hidden />
                    <span>{section.label}</span>
                  </span>
                  <span>{section.items.length}</span>
                </div>
                <div className="square-grid">
                  {section.items.map((view) => (
                    <button
                      key={`planner-item-${view.family.key}`}
                      type="button"
                      className={['item-tile', tileClassForItem(view.primaryType, view.primaryRarity)].join(' ')}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('application/x-arc-family-key', view.family.key);
                        event.dataTransfer.setData('text/plain', view.family.key);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => addFamilyToLoadout(view.family.key)}
                      title={`Add ${view.family.baseName} to loadout`}
                      aria-label={`Add ${view.family.baseName} to loadout`}
                    >
                      <div className="item-thumb">
                        {view.thumbnailIconUrl ? (
                          <LazyTileImage
                            src={view.thumbnailIconUrl}
                            alt={view.family.baseName}
                            isWeapon={isWeaponType(view.primaryType)}
                          />
                        ) : (
                          <div className="tile-placeholder" aria-hidden />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {plannerGroupedSections.length === 0 ? <div className="empty-grid">No families match planner filters.</div> : null}
          </div>

          <div
            className={`planner-dropzone ${dragOverDropzone ? 'drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverDropzone(true);
            }}
            onDragLeave={() => setDragOverDropzone(false)}
            onDrop={applyDropFamily}
          >
            <div className="planner-dropzone-head">
              <div className="section-head">Loadout</div>
              <div className="hint-text">Drag items from the library, or click tiles to add.</div>
            </div>

            {resolvedLoadout.length === 0 ? (
              <div className="empty-panel planner-empty-dropzone">Drop items here to start planning.</div>
            ) : (
              <div className="planner-loadout-list">
                {resolvedLoadout.map((row) => {
                  const hasLevels = row.family.variants.some((variant) => variant.level !== undefined);
                  return (
                    <div key={row.entry.key} className="planner-loadout-row">
                      <div className="planner-loadout-main">
                        <div className="item-thumb planner-loadout-thumb">
                          {row.variant.iconUrl ? (
                            <LazyTileImage
                              src={row.variant.iconUrl}
                              alt={row.variant.name}
                              isWeapon={isWeaponType(row.variant.type)}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div>
                          <div className="planner-loadout-name">{row.family.baseName}</div>
                          <div className="hint-text">{row.variant.name}</div>
                        </div>
                      </div>
                      <div className="planner-loadout-controls">
                        {hasLevels ? (
                          <select
                            className="planner-select"
                            value={row.variant.id}
                            onChange={(event) => {
                              const nextVariantId = event.target.value;
                              setLoadoutEntries((previous) =>
                                previous.map((entry) =>
                                  entry.key === row.entry.key ? { ...entry, variantId: nextVariantId } : entry,
                                ),
                              );
                            }}
                          >
                            {row.family.variants.map((variant) => (
                              <option key={variant.id} value={variant.id}>
                                {variantLabel(variant)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <div className="scope-toggle" role="group" aria-label="Craft mode">
                          <button
                            type="button"
                            className={`scope-button ${row.entry.mode === 'upgrade' ? 'active' : ''}`}
                            onClick={() =>
                              setLoadoutEntries((previous) =>
                                previous.map((entry) =>
                                  entry.key === row.entry.key ? { ...entry, mode: 'upgrade' } : entry,
                                ),
                              )
                            }
                          >
                            Upgrade
                          </button>
                          <button
                            type="button"
                            className={`scope-button ${row.entry.mode === 'craft' ? 'active' : ''}`}
                            onClick={() =>
                              setLoadoutEntries((previous) =>
                                previous.map((entry) =>
                                  entry.key === row.entry.key ? { ...entry, mode: 'craft' } : entry,
                                ),
                              )
                            }
                          >
                            Craft
                          </button>
                        </div>
                        <div className="planner-qty-control">
                          <button
                            type="button"
                            className="scope-button"
                            onClick={() =>
                              setLoadoutEntries((previous) =>
                                previous.map((entry) =>
                                  entry.key === row.entry.key ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry,
                                ),
                              )
                            }
                          >
                            -
                          </button>
                          <input
                            className="planner-qty-input"
                            type="number"
                            min={1}
                            value={row.entry.quantity}
                            onChange={(event) => {
                              const parsed = Number(event.target.value);
                              const quantity = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1;
                              setLoadoutEntries((previous) =>
                                previous.map((entry) =>
                                  entry.key === row.entry.key ? { ...entry, quantity } : entry,
                                ),
                              );
                            }}
                          />
                          <button
                            type="button"
                            className="scope-button"
                            onClick={() =>
                              setLoadoutEntries((previous) =>
                                previous.map((entry) =>
                                  entry.key === row.entry.key ? { ...entry, quantity: entry.quantity + 1 } : entry,
                                ),
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          className="planner-remove"
                          onClick={() => setLoadoutEntries((previous) => previous.filter((entry) => entry.key !== row.entry.key))}
                          aria-label={`Remove ${row.family.baseName}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="planner-summary">
            <div className="panel-section">
              <div className="section-head">Direct Totals</div>
              {directTotalViews.length > 0 ? (
                <div className="panel-tile-grid">
                  {directTotalViews.map((entry) => {
                    const tileClass = tileClassForItem(entry.item?.type, entry.item?.rarity);
                    return (
                      <div key={`direct-${entry.requirement.key}`} className={`panel-item-tile item-tile ${tileClass}`}>
                        <div className="item-thumb">
                          {entry.item?.iconUrl ? (
                            <LazyTileImage
                              src={entry.item.iconUrl}
                              alt={entry.requirement.name}
                              isWeapon={isWeaponType(entry.item.type)}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">{formatAmount(entry.requirement.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-panel">Add loadout items to compute direct materials.</div>
              )}
            </div>

            <div className="panel-section">
              <div className="section-head">Base Totals</div>
              {baseTotalViews.length > 0 ? (
                <div className="panel-tile-grid">
                  {baseTotalViews.map((entry) => {
                    const tileClass = tileClassForItem(entry.item?.type, entry.item?.rarity);
                    return (
                      <div key={`base-${entry.requirement.key}`} className={`panel-item-tile item-tile ${tileClass}`}>
                        <div className="item-thumb">
                          {entry.item?.iconUrl ? (
                            <LazyTileImage
                              src={entry.item.iconUrl}
                              alt={entry.requirement.name}
                              isWeapon={isWeaponType(entry.item.type)}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">{formatAmount(entry.requirement.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-panel">Base totals appear after direct requirements are available.</div>
              )}
            </div>

            <div className="panel-section">
              <div className="section-head-row">
                <div className="section-head">Recycler Plan</div>
                <div className="scope-toggle" role="group" aria-label="Recycler scope">
                  <button
                    type="button"
                    className={`scope-button ${plannerRecycleScope === 'materials' ? 'active' : ''}`}
                    onClick={() => setPlannerRecycleScope('materials')}
                  >
                    Materials
                  </button>
                  <button
                    type="button"
                    className={`scope-button ${plannerRecycleScope === 'withGear' ? 'active' : ''}`}
                    onClick={() => setPlannerRecycleScope('withGear')}
                  >
                    + Gear
                  </button>
                </div>
              </div>
              {recyclerPlan.length > 0 ? (
                <div className="panel-tile-grid">
                  {recyclerPlan.map((entry) => {
                    const recycleItem = itemById.get(entry.itemId);
                    const tileClass = tileClassForItem(recycleItem?.type ?? entry.itemType, recycleItem?.rarity);
                    return (
                      <div key={`recycler-${entry.itemId}`} className={`panel-item-tile item-tile ${tileClass}`} title={entry.covers.join(', ')}>
                        <div className="item-thumb">
                          {recycleItem?.iconUrl ? (
                            <LazyTileImage
                              src={recycleItem.iconUrl}
                              alt={entry.itemName}
                              isWeapon={isWeaponType(recycleItem.type)}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">x{entry.recycleCount}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-panel">Recycler recommendations will appear here.</div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
