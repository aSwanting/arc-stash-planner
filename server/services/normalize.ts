import type { RecipePart, SourceFetchResult, SourceItem } from '../types.js';

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
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

function nameFromUnknown(value: unknown): string | undefined {
  const direct = toStringOrUndefined(value);
  if (direct) {
    return direct;
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const english = toStringOrUndefined(object.en);
    if (english) {
      return english;
    }

    for (const candidate of Object.values(object)) {
      const first = toStringOrUndefined(candidate);
      if (first) {
        return first;
      }
    }
  }

  return undefined;
}

function normalizeRecipeParts(value: unknown): RecipePart[] | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const parts: RecipePart[] = [];

    for (const entry of value) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const item = entry as Record<string, unknown>;
      const nested = item.item && typeof item.item === 'object' ? (item.item as Record<string, unknown>) : undefined;
      const nestedComponent =
        item.component && typeof item.component === 'object'
          ? (item.component as Record<string, unknown>)
          : undefined;

      const amount =
        toNumberOrUndefined(item.amount) ??
        toNumberOrUndefined(item.quantity) ??
        toNumberOrUndefined(item.count) ??
        1;

      const itemId =
        toStringOrUndefined(item.itemId) ??
        toStringOrUndefined(item.id) ??
        toStringOrUndefined(nested?.id) ??
        toStringOrUndefined(nestedComponent?.id);

      const name =
        nameFromUnknown(item.name) ??
        nameFromUnknown(item.itemName) ??
        nameFromUnknown(nested?.name) ??
        nameFromUnknown(nestedComponent?.name);

      if (!itemId && !name) {
        continue;
      }

      parts.push({
        itemId,
        name,
        amount,
      });
    }

    parts.sort((a, b) => {
      const aKey = (a.itemId ?? a.name ?? '').toLowerCase();
      const bKey = (b.itemId ?? b.name ?? '').toLowerCase();
      return aKey.localeCompare(bKey);
    });

    return parts.length > 0 ? parts : undefined;
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const parts: RecipePart[] = [];

    for (const [key, amount] of Object.entries(object)) {
      const numericAmount = toNumberOrUndefined(amount);
      if (!numericAmount || numericAmount <= 0) {
        continue;
      }

      parts.push({
        itemId: key,
        amount: numericAmount,
      });
    }

    parts.sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));

    return parts.length > 0 ? parts : undefined;
  }

  return undefined;
}

function normalizeArdbItem(raw: Record<string, unknown>): SourceItem {
  const sourceItemId = toStringOrUndefined(raw.id);
  const name = nameFromUnknown(raw.name);

  const crafting = raw.craftingRequirement as Record<string, unknown> | undefined;
  const requiredItems = Array.isArray(crafting?.requiredItems) ? crafting?.requiredItems : undefined;

  let inputs = normalizeRecipeParts(requiredItems);
  if (!inputs) {
    inputs = normalizeRecipeParts(raw.recipe);
  }

  let outputs: RecipePart[] | undefined;
  if (sourceItemId && crafting) {
    const outputAmount = toNumberOrUndefined(crafting.outputAmount) ?? 1;
    outputs = [{ itemId: sourceItemId, name, amount: outputAmount }];
  }

  return {
    sourceId: 'ardb',
    sourceItemId,
    name,
    type: toStringOrUndefined(raw.type),
    rarity: toStringOrUndefined(raw.rarity),
    value: toNumberOrUndefined(raw.value),
    weight: toNumberOrUndefined(raw.weight),
    inputs,
    outputs,
    raw,
  };
}

function normalizeMetaForgeItem(raw: Record<string, unknown>): SourceItem {
  const sourceItemId = toStringOrUndefined(raw.id);
  const name = nameFromUnknown(raw.name);

  const statBlock = raw.stat_block as Record<string, unknown> | undefined;

  const inputs =
    normalizeRecipeParts(raw.components) ??
    normalizeRecipeParts(raw.recipe) ??
    normalizeRecipeParts(raw.ingredients);

  let outputs = normalizeRecipeParts(raw.outputs) ?? normalizeRecipeParts(raw.output);
  if (!outputs && sourceItemId && inputs) {
    outputs = [{ itemId: sourceItemId, name, amount: 1 }];
  }

  return {
    sourceId: 'metaforge',
    sourceItemId,
    name,
    type: toStringOrUndefined(raw.item_type) ?? toStringOrUndefined(raw.type),
    rarity: toStringOrUndefined(raw.rarity),
    value: toNumberOrUndefined(raw.value),
    weight: toNumberOrUndefined(statBlock?.weight) ?? toNumberOrUndefined(raw.weight),
    inputs,
    outputs,
    raw,
  };
}

function normalizeRaidTheoryLikeItem(
  sourceId: SourceItem['sourceId'],
  raw: Record<string, unknown>,
): SourceItem {
  const sourceItemId = toStringOrUndefined(raw.id);
  const name = nameFromUnknown(raw.name);

  const inputs = normalizeRecipeParts(raw.recipe);
  const outputs = inputs && sourceItemId ? [{ itemId: sourceItemId, name, amount: 1 }] : undefined;

  return {
    sourceId,
    sourceItemId,
    name,
    type: toStringOrUndefined(raw.type),
    rarity: toStringOrUndefined(raw.rarity),
    value: toNumberOrUndefined(raw.value),
    weight: toNumberOrUndefined(raw.weightKg) ?? toNumberOrUndefined(raw.weight),
    inputs,
    outputs,
    raw,
  };
}

export function normalizeSourceFetch(result: SourceFetchResult): SourceItem[] {
  return result.itemsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((raw) => {
      switch (result.sourceId) {
        case 'ardb':
          return normalizeArdbItem(raw);
        case 'metaforge':
          return normalizeMetaForgeItem(raw);
        case 'raidtheory':
          return normalizeRaidTheoryLikeItem('raidtheory', raw);
        case 'mahcks':
          return normalizeRaidTheoryLikeItem('mahcks', raw);
        default:
          return {
            sourceId: result.sourceId,
            raw,
          };
      }
    });
}
