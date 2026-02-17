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
  if (normalized === 'cosmetic') {
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
  if (normalized === 'trinket' || normalized === 'nature' || normalized === 'blueprint' || normalized === 'misc' || normalized === 'gadget') {
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
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | undefined>();
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [recycleScope, setRecycleScope] = useState<'materials' | 'withGear'>('materials');
  const [directMode, setDirectMode] = useState<'upgrade' | 'craft'>('upgrade');
  const [recycleLinksMode, setRecycleLinksMode] = useState<'from' | 'into'>('from');
  const [selectedRecycleLinkKey, setSelectedRecycleLinkKey] = useState<string | undefined>();
  const [focusSelection, setFocusSelection] = useState<FocusState | undefined>();
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

  const families = useMemo(() => toFamilies(plannerItems), [plannerItems]);

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

        return {
          family,
          primaryType,
          primaryRarity,
          category,
          hasCraftData,
          hasRecycleData,
          thumbnailIconUrl: primary?.iconUrl,
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

  const filteredFamilyViews = useMemo(() => {
    const normalizedSearch = normalizeKey(search);

    return familyViews.filter((view) => {
      if (!normalizedSearch) {
        return true;
      }

      if (normalizeKey(view.family.baseName).includes(normalizedSearch)) {
        return true;
      }

      return view.family.variants.some((variant) => normalizeKey(variant.name).includes(normalizedSearch));
    });
  }, [familyViews, search]);

  const groupedSections = useMemo(() => {
    const map = new Map<UiCategoryId, FamilyView[]>();
    for (const view of filteredFamilyViews) {
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
  }, [filteredFamilyViews]);

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

  useEffect(() => {
    setFocusSelection(undefined);
    setSelectedRecycleLinkKey(undefined);
    setRecycleLinksMode('from');
  }, [selectedVariantId]);

  const recycleIndex = useMemo(() => buildRecycleIndex(plannerItems), [plannerItems]);

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

  const selectedRecycleIntoViews = useMemo<RecycleLinkView[]>(() => {
    const entries = selectedVariant?.raw?.recycle_components;
    if (!Array.isArray(entries)) {
      return [];
    }

    const totals = new Map<string, RecycleLinkView>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const nested = row.component && typeof row.component === 'object' ? (row.component as Record<string, unknown>) : undefined;
      const nestedId = typeof nested?.id === 'string' ? nested.id.toLowerCase() : undefined;
      const nestedName = typeof nested?.name === 'string' ? nested.name : nestedId;
      if (!nestedId && !nestedName) {
        continue;
      }

      const key = nestedId ?? `name:${normalizeKey(nestedName ?? 'unknown')}`;
      const quantity = numberFromUnknown(row.quantity) ?? numberFromUnknown(row.amount) ?? numberFromUnknown(row.count) ?? 1;
      const linkedItem = nestedId ? itemById.get(nestedId) : itemByName.get(normalizeKey(nestedName ?? ''))?.[0];

      const iconUrlRaw = typeof nested?.icon === 'string' ? proxyIconUrl(nested.icon) : linkedItem?.iconUrl;
      const name = nestedName ?? linkedItem?.name ?? 'Unknown';
      const type = (typeof nested?.item_type === 'string' ? nested.item_type : undefined) ?? linkedItem?.type;
      const rarity = (typeof nested?.rarity === 'string' ? nested.rarity : undefined) ?? linkedItem?.rarity;

      const existing = totals.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        totals.set(key, {
          key,
          itemId: nestedId,
          name,
          type,
          rarity,
          iconUrl: iconUrlRaw,
          quantity,
        });
      }
    }

    return Array.from(totals.values()).sort((left, right) => {
      if (left.quantity !== right.quantity) {
        return right.quantity - left.quantity;
      }
      return left.name.localeCompare(right.name);
    });
  }, [selectedVariant, itemById, itemByName]);

  const selectedRecycleFromViews = useMemo<RecycleLinkView[]>(() => {
    const entries = selectedVariant?.raw?.recycle_from;
    if (!Array.isArray(entries)) {
      return [];
    }

    const totals = new Map<string, RecycleLinkView>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const nested = row.item && typeof row.item === 'object' ? (row.item as Record<string, unknown>) : undefined;
      const nestedId = typeof nested?.id === 'string' ? nested.id.toLowerCase() : undefined;
      const nestedName = typeof nested?.name === 'string' ? nested.name : nestedId;
      if (!nestedId && !nestedName) {
        continue;
      }

      const key = nestedId ?? `name:${normalizeKey(nestedName ?? 'unknown')}`;
      const quantity = numberFromUnknown(row.quantity) ?? numberFromUnknown(row.amount) ?? numberFromUnknown(row.count) ?? 1;
      const linkedItem = nestedId ? itemById.get(nestedId) : itemByName.get(normalizeKey(nestedName ?? ''))?.[0];

      const iconUrlRaw = typeof nested?.icon === 'string' ? proxyIconUrl(nested.icon) : linkedItem?.iconUrl;
      const name = nestedName ?? linkedItem?.name ?? 'Unknown';
      const type = (typeof nested?.item_type === 'string' ? nested.item_type : undefined) ?? linkedItem?.type;
      const rarity = (typeof nested?.rarity === 'string' ? nested.rarity : undefined) ?? linkedItem?.rarity;

      const existing = totals.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        totals.set(key, {
          key,
          itemId: nestedId,
          name,
          type,
          rarity,
          iconUrl: iconUrlRaw,
          quantity,
        });
      }
    }

    return Array.from(totals.values()).sort((left, right) => {
      if (left.quantity !== right.quantity) {
        return right.quantity - left.quantity;
      }
      return left.name.localeCompare(right.name);
    });
  }, [selectedVariant, itemById, itemByName]);

  const hasRecycleInto = selectedRecycleIntoViews.length > 0;
  const hasRecycleFrom = selectedRecycleFromViews.length > 0;
  const activeRecycleLinks = recycleLinksMode === 'from' ? selectedRecycleFromViews : selectedRecycleIntoViews;

  useEffect(() => {
    if (hasRecycleFrom) {
      return;
    }
    if (hasRecycleInto) {
      setRecycleLinksMode('into');
      return;
    }
  }, [hasRecycleFrom, hasRecycleInto]);

  useEffect(() => {
    if (!selectedRecycleLinkKey) {
      return;
    }
    if (!activeRecycleLinks.some((entry) => entry.key === selectedRecycleLinkKey)) {
      setSelectedRecycleLinkKey(undefined);
    }
  }, [activeRecycleLinks, selectedRecycleLinkKey]);

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

  const directRequirements = useMemo(() => {
    if (!selectedVariant) {
      return [];
    }
    if (directMode === 'upgrade') {
      return toRequirementRows(selectedVariant.inputs.filter((input) => !isBlueprintPart(input)));
    }

    return toRequirementRows(computeUpgradeCraftParts(selectedFamily, selectedVariant, itemById, isBlueprintPart));
  }, [directMode, selectedFamily, selectedVariant, itemById, isBlueprintPart]);

  const toRequirementViews = useCallback(
    (requirements: RequirementRow[]): RequirementView[] =>
      requirements.map((requirement) => {
        const bucketKey = requirement.itemId ? requirement.itemId.toLowerCase() : `name:${normalizeKey(requirement.name)}`;
        const candidates = recycleIndex.get(bucketKey) ?? [];
        const scopedCandidates = recycleScope === 'materials' ? candidates.filter((candidate) => candidate.isMaterialLike) : candidates;
        const topCandidates = scopedCandidates
          .map((candidate) => ({
            ...candidate,
            recycleCount: Math.ceil(requirement.amount / candidate.yield),
          }))
          .sort((left, right) => {
            if (left.recycleCount !== right.recycleCount) {
              return left.recycleCount - right.recycleCount;
            }
            if (left.yield !== right.yield) {
              return right.yield - left.yield;
            }
            return left.itemName.localeCompare(right.itemName);
          })
          .slice(0, 4);

        const requirementItem =
          (requirement.itemId ? itemById.get(requirement.itemId.toLowerCase()) : undefined) ??
          itemByName.get(normalizeKey(requirement.name))?.[0];

        return {
          requirement,
          requirementItem,
          topCandidates,
        };
      }),
    [recycleIndex, recycleScope, itemById, itemByName],
  );

  const directRequirementViews = useMemo<RequirementView[]>(() => {
    return toRequirementViews(directRequirements);
  }, [toRequirementViews, directRequirements]);

  const directChainViews = useMemo(() => {
    return directRequirementViews.map((entry) => {
      const rows: RequirementRow[] = [];
      if (entry.requirementItem) {
        const expanded = computeExpandedRequirements(entry.requirementItem, itemById, isBlueprintPart);
        const scaled = scaleRequirementRows(expanded, entry.requirement.amount);
        if (scaled.length > 0) {
          rows.push(...scaled);
        } else {
          rows.push(entry.requirement);
        }
      } else {
        rows.push(entry.requirement);
      }

      const views = toRequirementViews(rows);
      return {
        directKey: entry.requirement.key,
        views,
        materialKeys: new Set(views.map((view) => view.requirement.key)),
        recyclerIds: new Set(views.flatMap((view) => view.topCandidates.map((candidate) => candidate.itemId))),
      };
    });
  }, [directRequirementViews, itemById, toRequirementViews, isBlueprintPart]);

  const drilledRequirements = useMemo<RequirementRow[]>(() => {
    const totals = new Map<string, RequirementRow>();
    for (const chain of directChainViews) {
      for (const view of chain.views) {
        const existing = totals.get(view.requirement.key);
        if (existing) {
          existing.amount += view.requirement.amount;
          continue;
        }
        totals.set(view.requirement.key, { ...view.requirement });
      }
    }

    return Array.from(totals.values()).sort((left, right) => {
      if (left.amount !== right.amount) {
        return right.amount - left.amount;
      }
      return left.name.localeCompare(right.name);
    });
  }, [directChainViews]);

  const drilledRequirementViews = useMemo<RequirementView[]>(() => toRequirementViews(drilledRequirements), [toRequirementViews, drilledRequirements]);

  const allRecycleViews = useMemo<RecycleAggregateView[]>(() => {
    const totals = new Map<string, RecycleAggregateView>();

    for (const entry of drilledRequirementViews) {
      for (const candidate of entry.topCandidates) {
        const existing = totals.get(candidate.itemId);
        if (existing) {
          existing.recycleCount += candidate.recycleCount;
          if (!existing.covers.includes(entry.requirement.name)) {
            existing.covers.push(entry.requirement.name);
          }
          continue;
        }

        totals.set(candidate.itemId, {
          itemId: candidate.itemId,
          itemName: candidate.itemName,
          itemType: candidate.itemType,
          recycleCount: candidate.recycleCount,
          covers: [entry.requirement.name],
        });
      }
    }

    return Array.from(totals.values()).sort((left, right) => {
      if (left.recycleCount !== right.recycleCount) {
        return right.recycleCount - left.recycleCount;
      }
      return left.itemName.localeCompare(right.itemName);
    });
  }, [drilledRequirementViews]);

  const focusedDirectKeys = useMemo(() => {
    if (!focusSelection) {
      return undefined;
    }

    if (focusSelection.kind === 'direct') {
      return new Set<string>([focusSelection.key]);
    }

    if (focusSelection.kind === 'material') {
      const matches = directChainViews
        .filter((chain) => chain.materialKeys.has(focusSelection.key))
        .map((chain) => chain.directKey);
      return new Set<string>(matches);
    }

    const matches = directChainViews
      .filter((chain) => chain.recyclerIds.has(focusSelection.key))
      .map((chain) => chain.directKey);
    return new Set<string>(matches);
  }, [focusSelection, directChainViews]);

  const focusedMaterialKeys = useMemo(() => {
    if (!focusSelection) {
      return undefined;
    }

    const keys = new Set<string>();
    for (const chain of directChainViews) {
      if (!focusedDirectKeys?.has(chain.directKey)) {
        continue;
      }
      for (const materialKey of chain.materialKeys) {
        keys.add(materialKey);
      }
    }
    return keys;
  }, [focusSelection, directChainViews, focusedDirectKeys]);

  const focusedRecyclerIds = useMemo(() => {
    if (!focusSelection) {
      return undefined;
    }

    const ids = new Set<string>();
    for (const chain of directChainViews) {
      if (!focusedDirectKeys?.has(chain.directKey)) {
        continue;
      }
      for (const recyclerId of chain.recyclerIds) {
        ids.add(recyclerId);
      }
    }
    return ids;
  }, [focusSelection, directChainViews, focusedDirectKeys]);

  const hasFocus = Boolean(focusSelection);

  useEffect(() => {
    if (!focusSelection) {
      return;
    }

    if (focusSelection.kind === 'direct') {
      if (!directRequirementViews.some((entry) => entry.requirement.key === focusSelection.key)) {
        setFocusSelection(undefined);
      }
      return;
    }

    if (focusSelection.kind === 'material') {
      if (!drilledRequirementViews.some((entry) => entry.requirement.key === focusSelection.key)) {
        setFocusSelection(undefined);
      }
      return;
    }

    if (!allRecycleViews.some((entry) => entry.itemId === focusSelection.key)) {
      setFocusSelection(undefined);
    }
  }, [focusSelection, directRequirementViews, drilledRequirementViews, allRecycleViews]);

  const toggleFocus = useCallback((kind: FocusState['kind'], key: string) => {
    setFocusSelection((previous) => {
      if (previous?.kind === kind && previous.key === key) {
        return undefined;
      }
      return { kind, key };
    });
  }, []);

  const closePanel = useCallback(() => {
    setSelectedFamilyKey(undefined);
    setSelectedVariantId(undefined);
    setFocusSelection(undefined);
    setSelectedRecycleLinkKey(undefined);
  }, []);

  useEffect(() => {
    if (!selectedFamily) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedFamily, closePanel]);

  const onSelectFamily = (family: ItemFamily) => {
    if (selectedFamilyKey === family.key) {
      closePanel();
      return;
    }

    setFocusSelection(undefined);
    setSelectedRecycleLinkKey(undefined);
    setSelectedFamilyKey(family.key);
    setSelectedVariantId(defaultVariantForFamily(family)?.id);
  };

  return (
    <div className={`app-root ${selectedFamily ? 'panel-open' : ''}`}>
      <header className="header-shell">
        <div className="header-top">
          <div className="arc-logo-block" aria-hidden>
            <span className="arc-logo-stripes" />
          </div>
          <div className="header-title-wrap">
            <div className="header-title">ARC Data Explorer</div>
            <div className="header-subtitle">Dense thumbnail grid with fast filtering and drill-down</div>
          </div>
        </div>
        <div className="header-row">
          <input
            className="search-input"
            type="text"
            value={search}
            placeholder="Type to filter squares..."
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="header-meta">
          {loading ? 'Loading...' : 'Ready'} | Families: {filteredFamilyViews.length} / {familyViews.length}
          {data ? ` | Updated: ${new Date(data.generatedAt).toLocaleString()}` : ''}
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

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
                          <img
                            src={view.thumbnailIconUrl}
                            alt={view.family.baseName}
                            loading="lazy"
                            className={isWeaponType(view.primaryType) ? 'weapon-icon' : undefined}
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

      {selectedFamily ? <button type="button" className="panel-backdrop" onClick={closePanel} aria-label="Close details" /> : null}

      <aside className={`side-panel ${selectedFamily ? 'open' : ''}`} aria-hidden={!selectedFamily}>
        {selectedFamily ? (
          <>
            <div className="panel-head">
              <div>
                <div className="panel-title">{selectedFamily.baseName}</div>
                <div className="panel-subtitle">{selectedVariant?.name ?? selectedFamily.baseName}</div>
              </div>
              <div className="panel-head-actions">
                <button type="button" className="close-btn" onClick={closePanel}>
                  Close
                </button>
              </div>
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
                </div>
              </div>
            ) : null}

            {hasRecycleInto || hasRecycleFrom ? (
              <div className="panel-section">
                <div className="section-head-row">
                  <div className="section-head">Recycle Links</div>
                  {hasRecycleInto && hasRecycleFrom ? (
                    <div className="scope-toggle" role="group" aria-label="Recycle link mode">
                      <button
                        type="button"
                        className={`scope-button ${recycleLinksMode === 'from' ? 'active' : ''}`}
                        onClick={() => setRecycleLinksMode('from')}
                      >
                        From
                      </button>
                      <button
                        type="button"
                        className={`scope-button ${recycleLinksMode === 'into' ? 'active' : ''}`}
                        onClick={() => setRecycleLinksMode('into')}
                      >
                        Into
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="panel-tile-grid">
                  {activeRecycleLinks.map((entry) => {
                    const recycleClass = tileClassForItem(entry.type, entry.rarity);
                    const selected = selectedRecycleLinkKey === entry.key;
                    const dimmed = Boolean(selectedRecycleLinkKey) && !selected;
                    return (
                      <button
                        key={`link-${entry.key}`}
                        type="button"
                        className={`panel-item-tile panel-item-tab item-tile ${recycleClass} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
                        onClick={() => {
                          setFocusSelection(undefined);
                          setSelectedRecycleLinkKey((previous) => (previous === entry.key ? undefined : entry.key));
                        }}
                        title={`${entry.name} x${formatAmount(entry.quantity)}`}
                      >
                        <div className="item-thumb">
                          {entry.iconUrl ? (
                            <img
                              src={entry.iconUrl}
                              alt={entry.name}
                              loading="lazy"
                              className={isWeaponType(entry.type) ? 'weapon-icon' : undefined}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">x{formatAmount(entry.quantity)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {directRequirementViews.length > 0 ? (
              <div className="panel-section">
                <div className="section-head-row">
                  <div className="section-head">Direct Materials</div>
                  {showLevelSelector ? (
                    <div className="scope-toggle" role="group" aria-label="Direct material mode">
                      <button
                        type="button"
                        className={`scope-button ${directMode === 'upgrade' ? 'active' : ''}`}
                        onClick={() => setDirectMode('upgrade')}
                      >
                        Upgrade
                      </button>
                      <button
                        type="button"
                        className={`scope-button ${directMode === 'craft' ? 'active' : ''}`}
                        onClick={() => setDirectMode('craft')}
                      >
                        Craft
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="panel-tile-grid">
                  {directRequirementViews.map((entry) => {
                    const requirementClass = tileClassForItem(entry.requirementItem?.type, entry.requirementItem?.rarity);
                    const selected = focusedDirectKeys?.has(entry.requirement.key) ?? false;
                    const dimmed = hasFocus && !selected;
                    return (
                      <button
                        key={entry.requirement.key}
                        type="button"
                        className={`panel-item-tile panel-item-tab item-tile ${requirementClass} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
                        onClick={() => {
                          setSelectedRecycleLinkKey(undefined);
                          toggleFocus('direct', entry.requirement.key);
                        }}
                        title={`${entry.requirement.name}: ${formatAmount(entry.requirement.amount)}`}
                      >
                        <div className="item-thumb">
                          {entry.requirementItem?.iconUrl ? (
                            <img
                              src={entry.requirementItem.iconUrl}
                              alt={entry.requirement.name}
                              loading="lazy"
                              className={isWeaponType(entry.requirementItem.type) ? 'weapon-icon' : undefined}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">{formatAmount(entry.requirement.amount)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {drilledRequirementViews.length > 0 ? (
              <div className="panel-section">
                <div className="section-head">Base Materials</div>
                <div className="panel-tile-grid">
                  {drilledRequirementViews.map((entry) => {
                    const drilledClass = tileClassForItem(entry.requirementItem?.type, entry.requirementItem?.rarity);
                    const selected = focusedMaterialKeys?.has(entry.requirement.key) ?? false;
                    const dimmed = hasFocus && !selected;
                    return (
                      <button
                        key={`drill-${entry.requirement.key}`}
                        type="button"
                        className={`panel-item-tile panel-item-tab item-tile ${drilledClass} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
                        onClick={() => {
                          setSelectedRecycleLinkKey(undefined);
                          toggleFocus('material', entry.requirement.key);
                        }}
                        title={`${entry.requirement.name}: ${formatAmount(entry.requirement.amount)}`}
                      >
                        <div className="item-thumb">
                          {entry.requirementItem?.iconUrl ? (
                            <img
                              src={entry.requirementItem.iconUrl}
                              alt={entry.requirement.name}
                              loading="lazy"
                              className={isWeaponType(entry.requirementItem.type) ? 'weapon-icon' : undefined}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">{formatAmount(entry.requirement.amount)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {allRecycleViews.length > 0 ? (
              <div className="panel-section">
                <div className="section-head-row">
                  <div className="section-head">Recyclables</div>
                  <div className="scope-toggle" role="group" aria-label="Recyclable scope">
                    <button
                      type="button"
                      className={`scope-button ${recycleScope === 'materials' ? 'active' : ''}`}
                      onClick={() => setRecycleScope('materials')}
                    >
                      Materials
                    </button>
                    <button
                      type="button"
                      className={`scope-button ${recycleScope === 'withGear' ? 'active' : ''}`}
                      onClick={() => setRecycleScope('withGear')}
                    >
                      + Gear
                    </button>
                  </div>
                </div>
                <div className="panel-tile-grid">
                  {allRecycleViews.map((entry) => {
                    const recycleItem = itemById.get(entry.itemId);
                    const recycleClass = tileClassForItem(recycleItem?.type ?? entry.itemType, recycleItem?.rarity);
                    const selected = focusedRecyclerIds?.has(entry.itemId) ?? false;
                    const dimmed = hasFocus && !selected;
                    return (
                      <button
                        key={entry.itemId}
                        type="button"
                        className={`panel-item-tile panel-item-tab item-tile ${recycleClass} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
                        onClick={() => {
                          setSelectedRecycleLinkKey(undefined);
                          toggleFocus('recycler', entry.itemId);
                        }}
                        title={`${entry.itemName} x${entry.recycleCount}`}
                      >
                        <div className="item-thumb">
                          {recycleItem?.iconUrl ? (
                            <img
                              src={recycleItem.iconUrl}
                              alt={entry.itemName}
                              loading="lazy"
                              className={isWeaponType(recycleItem?.type ?? entry.itemType) ? 'weapon-icon' : undefined}
                            />
                          ) : (
                            <div className="tile-placeholder" aria-hidden />
                          )}
                        </div>
                        <div className="tile-count">x{entry.recycleCount}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

          </>
        ) : null}
      </aside>
    </div>
  );
}
