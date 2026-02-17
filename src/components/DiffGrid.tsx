import { memo, useMemo } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { CanonicalItem, SourceId, SourceItem } from '../types';

interface DiffGridProps {
  items: CanonicalItem[];
  sources: SourceId[];
  selectedId?: string;
  onRowClick: (item: CanonicalItem) => void;
}

function recipeSummary(item: SourceItem | undefined): string {
  if (!item) {
    return '-';
  }

  const inputCount = item.inputs?.length ?? 0;
  const outputCount = item.outputs?.length ?? 0;

  if (inputCount === 0 && outputCount === 0) {
    return '-';
  }

  return `in:${inputCount} out:${outputCount}`;
}

function sourceCell(item: SourceItem | undefined): JSX.Element {
  if (!item) {
    return <div className="source-cell missing">missing</div>;
  }

  return (
    <div className="source-cell">
      <div className="source-line">id: {item.sourceItemId ?? '-'}</div>
      <div className="source-line">type: {item.type ?? '-'}</div>
      <div className="source-line">rarity: {item.rarity ?? '-'}</div>
      <div className="source-line">value: {item.value ?? '-'} | weight: {item.weight ?? '-'}</div>
      <div className="source-line">recipe: {recipeSummary(item)}</div>
    </div>
  );
}

interface RowData {
  items: CanonicalItem[];
  sources: SourceId[];
  selectedId?: string;
  columnTemplate: string;
  onRowClick: (item: CanonicalItem) => void;
}

const Row = memo(({ data, index, style }: ListChildComponentProps<RowData>) => {
  const item = data.items[index];
  const isSelected = item.canonicalId === data.selectedId;

  const badges: string[] = [];
  if (item.diffReport.severity > 0) {
    badges.push(`sev:${item.diffReport.severity}`);
  }
  if (item.diffReport.missingIn.length > 0) {
    badges.push(`missing:${item.diffReport.missingIn.length}`);
  }
  if (item.diffReport.fieldDiffers.name) badges.push('name');
  if (item.diffReport.fieldDiffers.type) badges.push('type');
  if (item.diffReport.fieldDiffers.rarity) badges.push('rarity');
  if (item.diffReport.fieldDiffers.value) badges.push('value');
  if (item.diffReport.fieldDiffers.weight) badges.push('weight');
  if (item.diffReport.recipeDiffers) badges.push('recipe');

  return (
    <div
      style={style}
      className={`grid-row ${isSelected ? 'selected' : ''}`}
      onClick={() => data.onRowClick(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onRowClick(item);
        }
      }}
    >
      <div className="grid-row-inner" style={{ gridTemplateColumns: data.columnTemplate }}>
        <div className="cell name-cell">{item.displayName}</div>
        <div className="cell badges-cell">{badges.join(' | ') || '-'}</div>
        {data.sources.map((sourceId) => (
          <div key={`${item.canonicalId}-${sourceId}`} className="cell">
            {sourceCell(item.bySource[sourceId])}
          </div>
        ))}
      </div>
    </div>
  );
});

Row.displayName = 'Row';

export function DiffGrid({ items, sources, selectedId, onRowClick }: DiffGridProps) {
  const columnTemplate = useMemo(() => {
    return `260px 220px ${sources.map(() => 'minmax(230px, 1fr)').join(' ')}`;
  }, [sources]);

  const rowData = useMemo<RowData>(() => {
    return {
      items,
      sources,
      selectedId,
      columnTemplate,
      onRowClick,
    };
  }, [items, sources, selectedId, columnTemplate, onRowClick]);

  return (
    <div className="grid-wrapper">
      <div className="grid-header" style={{ gridTemplateColumns: columnTemplate }}>
        <div className="cell">Name</div>
        <div className="cell">Diff badges</div>
        {sources.map((sourceId) => (
          <div key={sourceId} className="cell source-header">
            {sourceId.toUpperCase()}
          </div>
        ))}
      </div>

      <FixedSizeList
        className="virtual-list"
        itemCount={items.length}
        itemSize={110}
        width="100%"
        height={Math.max(360, window.innerHeight - 280)}
        itemData={rowData}
      >
        {Row}
      </FixedSizeList>
    </div>
  );
}
