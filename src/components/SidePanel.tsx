import type { CanonicalItem, SourceId } from '../types';

interface SidePanelProps {
  item?: CanonicalItem;
  sources: SourceId[];
  onClose: () => void;
}

export function SidePanel({ item, sources, onClose }: SidePanelProps) {
  if (!item) {
    return null;
  }

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <strong>{item.displayName}</strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="side-panel-meta">
        <div>Severity: {item.diffReport.severity}</div>
        <div>Missing in: {item.diffReport.missingIn.join(', ') || '-'}</div>
        <div>
          Flags: name={String(item.diffReport.fieldDiffers.name)} type={String(item.diffReport.fieldDiffers.type)} rarity=
          {String(item.diffReport.fieldDiffers.rarity)} value={String(item.diffReport.fieldDiffers.value)} weight=
          {String(item.diffReport.fieldDiffers.weight)} recipe={String(item.diffReport.recipeDiffers)}
        </div>
      </div>

      <div className="side-panel-section">
        <strong>Diff explanation</strong>
        <ul>
          {item.diffReport.explanation.map((line, index) => (
            <li key={`${item.canonicalId}-exp-${index}`}>{line}</li>
          ))}
          {item.diffReport.explanation.length === 0 ? <li>No diffs.</li> : null}
        </ul>
      </div>

      {sources.map((sourceId) => {
        const sourceItem = item.bySource[sourceId];

        return (
          <div key={`${item.canonicalId}-${sourceId}`} className="side-panel-section">
            <strong>{sourceId.toUpperCase()}</strong>
            {!sourceItem ? (
              <div>Missing from source</div>
            ) : (
              <>
                <details open>
                  <summary>Normalized JSON</summary>
                  <pre>{JSON.stringify(sourceItem, null, 2)}</pre>
                </details>
                <details>
                  <summary>Raw JSON</summary>
                  <pre>{JSON.stringify(sourceItem.raw, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        );
      })}
    </aside>
  );
}
