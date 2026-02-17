import type { SourceId } from '../types';

export interface GridFilters {
  search: string;
  onlyDiffs: boolean;
  missingIn: Partial<Record<SourceId, boolean>>;
  fieldDiffers: {
    name: boolean;
    type: boolean;
    rarity: boolean;
    value: boolean;
    weight: boolean;
    recipe: boolean;
  };
}

interface FilterBarProps {
  sources: SourceId[];
  filters: GridFilters;
  onChange: (next: GridFilters) => void;
}

export function FilterBar({ sources, filters, onChange }: FilterBarProps) {
  return (
    <div className="filter-bar">
      <input
        className="search-input"
        type="text"
        placeholder="Search name/type/id"
        value={filters.search}
        onChange={(event) =>
          onChange({
            ...filters,
            search: event.target.value,
          })
        }
      />

      <label className="toggle">
        <input
          type="checkbox"
          checked={filters.onlyDiffs}
          onChange={(event) =>
            onChange({
              ...filters,
              onlyDiffs: event.target.checked,
            })
          }
        />
        only diffs
      </label>

      {sources.map((sourceId) => (
        <label key={sourceId} className="toggle">
          <input
            type="checkbox"
            checked={Boolean(filters.missingIn[sourceId])}
            onChange={(event) =>
              onChange({
                ...filters,
                missingIn: {
                  ...filters.missingIn,
                  [sourceId]: event.target.checked,
                },
              })
            }
          />
          missing in {sourceId}
        </label>
      ))}

      {(
        [
          ['name', 'name differs'],
          ['type', 'type differs'],
          ['rarity', 'rarity differs'],
          ['value', 'value differs'],
          ['weight', 'weight differs'],
          ['recipe', 'recipe differs'],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="toggle">
          <input
            type="checkbox"
            checked={filters.fieldDiffers[field]}
            onChange={(event) =>
              onChange({
                ...filters,
                fieldDiffers: {
                  ...filters.fieldDiffers,
                  [field]: event.target.checked,
                },
              })
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
}
