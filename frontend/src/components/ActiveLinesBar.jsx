import React from 'react';
import { Plus, X, Layers } from 'lucide-react';

export default function ActiveLinesBar({
  activeLines = [],
  buses = [],
  onRemoveLine,
  onQuickAddLine,
  popularSuggestions = [],
}) {
  return (
    <div className="active-lines-bar">
      <div className="active-lines-label">
        <Layers size={14} className="text-gray-500" />
        <span>Lignes suivies :</span>
      </div>

      <div className="active-lines-pills">
        {activeLines.map((line) => {
          const busCount = buses.filter(
            (b) => b.line === line.shortname || b.line_ref === line.line_ref
          ).length;

          return (
            <div
              key={line.shortname || line.id_line}
              className="line-chip"
              style={{ borderColor: line.color || '#009E94' }}
            >
              <span
                className="chip-badge"
                style={{ backgroundColor: line.color || '#009E94' }}
              >
                {line.shortname}
              </span>
              <span className="chip-name">{line.name?.split('↔')[0] || line.name}</span>
              <span className="chip-count">({busCount} bus)</span>

              {activeLines.length > 1 && (
                <button
                  onClick={() => onRemoveLine(line.shortname)}
                  className="chip-close-btn"
                  title={`Retirer la ligne ${line.shortname}`}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {popularSuggestions && popularSuggestions.length > 0 && (
        <div className="quick-suggestions">
          <span className="suggestions-label">Suggestions :</span>
          {popularSuggestions.map((sug) => (
            <button
              key={sug.shortname}
              className="suggestion-chip"
              onClick={() => onQuickAddLine(sug)}
              title={`Ajouter la ligne ${sug.shortname} (${sug.name})`}
            >
              <Plus size={11} />
              <span
                className="sug-badge"
                style={{ backgroundColor: sug.color || '#666' }}
              >
                {sug.shortname}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

