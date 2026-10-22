import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Bus, MapPin, Plus, ArrowRight, Loader2 } from 'lucide-react';

export default function SearchBar({ onAddLine, onSelectStop, activeLineCodes = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ lines: [], stops: [] });
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  // Recherche avec debounce
  useEffect(() => {
    if (!query.trim() || query.trim().length < 1) {
      setResults({ lines: [], stops: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (response.ok) {
          const data = await response.json();
          setResults(data);
          setIsOpen(true);
        }
      } catch (err) {
        console.warn('Erreur lors de la recherche:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  // Fermeture du dropdown lors d'un clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectLine = (line) => {
    onAddLine(line);
    setQuery('');
    setIsOpen(false);
  };

  const handleSelectStop = (stop) => {
    onSelectStop(stop);
    setQuery('');
    setIsOpen(false);
  };

  const hasResults = results.lines.length > 0 || results.stops.length > 0;

  return (
    <div className="search-bar-container" ref={containerRef}>
      <div className="search-input-wrapper">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (query.trim().length > 0) setIsOpen(true);
          }}
          placeholder="Rechercher une ligne (ex: 394, 194, 128, T6) ou un arrêt (ex: Division Leclerc, Scarron)..."
          className="search-input"
        />
        {loading && <Loader2 size={15} className="search-spinner spinning" />}
        {query && !loading && (
          <button
            onClick={() => {
              setQuery('');
              setResults({ lines: [], stops: [] });
              setIsOpen(false);
            }}
            className="search-clear-btn"
            title="Effacer"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {isOpen && (query.trim().length > 0) && (
        <div className="search-dropdown-results">
          {!hasResults && !loading && (
            <div className="search-empty-msg">
              Aucune ligne ni aucun arrêt trouvé pour "{query}".
            </div>
          )}

          {/* SECTION : LIGNES DE TRANSPORT */}
          {results.lines.length > 0 && (
            <div className="search-section">
              <div className="search-section-title">
                <Bus size={13} /> LIGNES DE TRANSPORT
              </div>
              <div className="search-items-list">
                {results.lines.map((line) => {
                  const isAlreadyAdded = activeLineCodes.includes(line.shortname) || activeLineCodes.includes(line.id_line);
                  return (
                    <div
                      key={line.id_line || line.shortname}
                      className="search-result-item"
                      onClick={() => handleSelectLine(line)}
                    >
                      <div
                        className="search-line-pill"
                        style={{ backgroundColor: line.color || '#009E94' }}
                      >
                        {line.shortname}
                      </div>
                      <div className="search-item-info">
                        <div className="search-item-main">{line.name}</div>
                        <div className="search-item-sub">
                          {line.operator} {line.mode ? `• ${line.mode.toUpperCase()}` : ''}
                        </div>
                      </div>
                      <button
                        className={`search-action-btn ${isAlreadyAdded ? 'btn-added' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectLine(line);
                        }}
                      >
                        {isAlreadyAdded ? (
                          'Active'
                        ) : (
                          <>
                            <Plus size={13} /> Suivre
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION : ARRÊTS DE BUS */}
          {results.stops.length > 0 && (
            <div className="search-section">
              <div className="search-section-title">
                <MapPin size={13} /> ARRÊTS & STATIONS
              </div>
              <div className="search-items-list">
                {results.stops.map((stop) => (
                  <div
                    key={`${stop.name}-${stop.lat}-${stop.lng}`}
                    className="search-result-item"
                    onClick={() => handleSelectStop(stop)}
                  >
                    <div className="stop-marker-pin">
                      <MapPin size={16} className="text-teal-600" />
                    </div>
                    <div className="search-item-info">
                      <div className="search-item-main">{stop.name}</div>
                      <div className="search-item-sub">
                        {stop.commune}
                        {stop.lines && stop.lines.length > 0 && stop.lines[0] && (
                          <span className="search-stop-lines">
                            Ligne {stop.lines.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="search-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectStop(stop);
                      }}
                    >
                      <ArrowRight size={13} /> Tracker l'arrêt
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

