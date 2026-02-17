import type {
  CanonicalItem,
  DiffReport,
  RecipePart,
  SourceId,
  SourceItem,
} from '../types.js';

function normalizeNameForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bigrams(value: string): string[] {
  const normalized = ` ${value} `;
  const output: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    output.push(normalized.slice(index, index + 2));
  }
  return output;
}

function similarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const token of leftBigrams) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const token of rightBigrams) {
    const current = counts.get(token) ?? 0;
    if (current > 0) {
      overlap += 1;
      counts.set(token, current - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function normalizeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
}

function normalizeNumber(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  return Math.round(value * 10_000) / 10_000;
}

function recipePartKey(part: RecipePart): string {
  return (part.itemId ?? part.name ?? '').toLowerCase();
}

function recipeSignature(item: SourceItem | undefined): string {
  if (!item) {
    return '__missing__';
  }

  const inputs = item.inputs
    ?.slice()
    .sort((a, b) => recipePartKey(a).localeCompare(recipePartKey(b)))
    .map((part) => `${recipePartKey(part)}:${part.amount}`)
    .join('|');

  const outputs = item.outputs
    ?.slice()
    .sort((a, b) => recipePartKey(a).localeCompare(recipePartKey(b)))
    .map((part) => `${recipePartKey(part)}:${part.amount}`)
    .join('|');

  if (!inputs && !outputs) {
    return '';
  }

  return `in[${inputs ?? ''}]out[${outputs ?? ''}]`;
}

function differsByValues<T>(values: Array<T | undefined>, normalizer: (value: T | undefined) => unknown): boolean {
  const normalized = values.map((value) => normalizer(value));
  const defined = normalized.filter((value) => value !== undefined);

  if (defined.length === 0) {
    return false;
  }

  const unique = new Set(defined.map((value) => JSON.stringify(value)));
  if (unique.size > 1) {
    return true;
  }

  return defined.length !== normalized.length;
}

function formatSourceValue(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return String(value);
}

function buildDiffReport(item: CanonicalItem, enabledSources: SourceId[]): DiffReport {
  const presentSources = enabledSources.filter((sourceId) => Boolean(item.bySource[sourceId]));
  const missingIn = enabledSources.filter((sourceId) => !item.bySource[sourceId]);

  const names = presentSources.map((sourceId) => item.bySource[sourceId]?.name);
  const types = presentSources.map((sourceId) => item.bySource[sourceId]?.type);
  const rarities = presentSources.map((sourceId) => item.bySource[sourceId]?.rarity);
  const values = presentSources.map((sourceId) => item.bySource[sourceId]?.value);
  const weights = presentSources.map((sourceId) => item.bySource[sourceId]?.weight);
  const recipes = presentSources.map((sourceId) => recipeSignature(item.bySource[sourceId]));

  const fieldDiffers = {
    name: differsByValues(names, normalizeText),
    type: differsByValues(types, normalizeText),
    rarity: differsByValues(rarities, normalizeText),
    value: differsByValues(values, normalizeNumber),
    weight: differsByValues(weights, normalizeNumber),
  };

  const recipeDiffers = differsByValues(recipes, (value) => (value ? value : undefined));

  let severity = 0;
  severity += missingIn.length * 18;
  severity += fieldDiffers.name ? 10 : 0;
  severity += fieldDiffers.type ? 8 : 0;
  severity += fieldDiffers.rarity ? 8 : 0;
  severity += fieldDiffers.value ? 12 : 0;
  severity += fieldDiffers.weight ? 12 : 0;
  severity += recipeDiffers ? 20 : 0;
  severity = Math.min(100, severity);

  const explanation: string[] = [];

  if (missingIn.length > 0) {
    explanation.push(`Missing in: ${missingIn.join(', ')}`);
  }

  if (fieldDiffers.name) {
    explanation.push(
      `Name differs: ${enabledSources
        .map((sourceId) => `${sourceId}=${formatSourceValue(item.bySource[sourceId]?.name)}`)
        .join(', ')}`,
    );
  }

  if (fieldDiffers.type) {
    explanation.push(
      `Type differs: ${enabledSources
        .map((sourceId) => `${sourceId}=${formatSourceValue(item.bySource[sourceId]?.type)}`)
        .join(', ')}`,
    );
  }

  if (fieldDiffers.rarity) {
    explanation.push(
      `Rarity differs: ${enabledSources
        .map((sourceId) => `${sourceId}=${formatSourceValue(item.bySource[sourceId]?.rarity)}`)
        .join(', ')}`,
    );
  }

  if (fieldDiffers.value) {
    explanation.push(
      `Value differs: ${enabledSources
        .map((sourceId) => `${sourceId}=${formatSourceValue(item.bySource[sourceId]?.value)}`)
        .join(', ')}`,
    );
  }

  if (fieldDiffers.weight) {
    explanation.push(
      `Weight differs: ${enabledSources
        .map((sourceId) => `${sourceId}=${formatSourceValue(item.bySource[sourceId]?.weight)}`)
        .join(', ')}`,
    );
  }

  if (recipeDiffers) {
    explanation.push('Recipe differs (inputs/outputs are not equivalent).');
  }

  return {
    missingIn,
    fieldDiffers,
    recipeDiffers,
    severity,
    explanation,
  };
}

function getDisplayName(item: SourceItem, fallbackIndex: number): string {
  return (
    item.name ??
    item.sourceItemId ??
    `${item.sourceId}-item-${fallbackIndex}`
  );
}

function getNameKey(item: SourceItem, fallbackIndex: number): string {
  if (item.name) {
    const normalized = normalizeNameForMatch(item.name);
    if (normalized) {
      return normalized;
    }
  }

  if (item.sourceItemId) {
    return `id:${item.sourceId}:${item.sourceItemId.toLowerCase()}`;
  }

  return `id:${item.sourceId}:${fallbackIndex}`;
}

export function mergeAndDiffItems(
  normalizedBySource: Partial<Record<SourceId, SourceItem[]>>,
  enabledSources: SourceId[],
  fuzzyThreshold: number,
): CanonicalItem[] {
  const canonicalItems: CanonicalItem[] = [];
  const nameIndex = new Map<string, number[]>();

  for (const sourceId of enabledSources) {
    const items = normalizedBySource[sourceId] ?? [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      const displayName = getDisplayName(item, itemIndex);
      const nameKey = getNameKey(item, itemIndex);

      let assignedIndex: number | undefined;
      let assignedMethod: 'exact' | 'fuzzy' | 'none' = 'none';
      let assignedConfidence = 1;

      const exactCandidates = nameIndex.get(nameKey) ?? [];
      for (const candidateIndex of exactCandidates) {
        const candidate = canonicalItems[candidateIndex];
        if (!candidate.bySource[sourceId]) {
          assignedIndex = candidateIndex;
          assignedMethod = 'exact';
          assignedConfidence = 1;
          break;
        }
      }

      if (assignedIndex === undefined && !nameKey.startsWith('id:')) {
        let bestIndex: number | undefined;
        let bestScore = 0;

        for (let candidateIndex = 0; candidateIndex < canonicalItems.length; candidateIndex += 1) {
          const candidate = canonicalItems[candidateIndex];
          if (candidate.bySource[sourceId]) {
            continue;
          }

          if (candidate.nameKey.startsWith('id:')) {
            continue;
          }

          const score = similarity(nameKey, candidate.nameKey);
          if (score > bestScore) {
            bestScore = score;
            bestIndex = candidateIndex;
          }
        }

        if (bestIndex !== undefined && bestScore >= fuzzyThreshold) {
          assignedIndex = bestIndex;
          assignedMethod = 'fuzzy';
          assignedConfidence = Math.round(bestScore * 1000) / 1000;
        }
      }

      if (assignedIndex === undefined) {
        const canonicalId = `canonical-${canonicalItems.length + 1}`;
        const nextItem: CanonicalItem = {
          canonicalId,
          nameKey,
          displayName,
          bySource: {
            [sourceId]: item,
          },
          matchDetails: {
            [sourceId]: {
              method: 'exact',
              confidence: 1,
            },
          },
          diffReport: {
            missingIn: [],
            fieldDiffers: {
              name: false,
              type: false,
              rarity: false,
              value: false,
              weight: false,
            },
            recipeDiffers: false,
            severity: 0,
            explanation: [],
          },
        };

        canonicalItems.push(nextItem);

        const list = nameIndex.get(nameKey) ?? [];
        list.push(canonicalItems.length - 1);
        nameIndex.set(nameKey, list);
      } else {
        canonicalItems[assignedIndex].bySource[sourceId] = item;
        canonicalItems[assignedIndex].matchDetails[sourceId] = {
          method: assignedMethod,
          confidence: assignedConfidence,
        };
      }
    }
  }

  for (const item of canonicalItems) {
    const preferredName = enabledSources
      .map((sourceId) => item.bySource[sourceId]?.name)
      .find((value): value is string => Boolean(value));
    if (preferredName) {
      item.displayName = preferredName;
    }

    item.diffReport = buildDiffReport(item, enabledSources);
  }

  return canonicalItems.sort((left, right) => {
    if (right.diffReport.severity !== left.diffReport.severity) {
      return right.diffReport.severity - left.diffReport.severity;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}
