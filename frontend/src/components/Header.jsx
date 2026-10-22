import React from 'react';
import { RefreshCw, MapPin, Bus, Radio, Key, ShieldCheck, AlertCircle } from 'lucide-react';
import SearchBar from './SearchBar';
import ActiveLinesBar from './ActiveLinesBar';

export default function Header({
  metadata,
  loading,
  onRefresh,
  countdown,
  totalBuses,
  activeLines = [],
  buses = [],
  onAddLine,
  onRemoveLine,
  onSelectStop,
  onCenterFontenay,
  showRoute,
  onToggleRoute,
  onOpenApiKeyGuide,
  popularSuggestions = [],
}) {
  const isOk = metadata?.status === 'ok';
  const isMissingKey = metadata?.status === 'missing_key';
  const activeLineCodes = activeLines.map((l) => l.shortname);

  return (
    <header className="app-header">
      <div className="header-top">
        {/* Titre & Logo */}
        <div className="brand-group">
          <div className="ratp-line-icon" title="Réseau Bus RATP / IDFM">
            <span className="line-prefix">BUS</span>
            <span className="line-number">
              {activeLines.length === 1 ? activeLines[0].shortname : activeLines.length}
            </span>
          </div>

          <div className="brand-titles">
            <h1 className="main-title">
              Suivi Temps Réel <span>RATP</span>
            </h1>
            <p className="subtitle">
              Secteur <strong>Fontenay-aux-Roses</strong> &amp; Île-de-France Mobilités
            </p>
          </div>
        </div>

        {/* Barre de recherche unifiée Lignes & Arrêts */}
        <div className="header-search-slot">
          <SearchBar
            onAddLine={onAddLine}
            onSelectStop={onSelectStop}
            activeLineCodes={activeLineCodes}
          />
        </div>

        {/* Statut & Actions rapides */}
        <div className="header-actions">
          {isMissingKey ? (
            <button
              onClick={onOpenApiKeyGuide}
              className="status-pill status-missing-key"
              title="Cliquez pour voir comment obtenir votre clé PRIM"
            >
              <Key size={13} />
              <span>Clé API requise</span>
            </button>
          ) : (
            <div className={`status-pill ${isOk ? 'status-live' : 'status-warn'}`}>
              <span className="pulse-dot"></span>
              <span className="status-text">
                {isOk ? `En direct PRIM (${totalBuses} bus)` : 'PRIM Connecté'}
              </span>
            </div>
          )}

          <button
            onClick={onCenterFontenay}
            className="action-btn btn-secondary"
            title="Recentrer la carte sur Fontenay-aux-Roses"
          >
            <MapPin size={15} />
            <span className="btn-label">Fontenay</span>
          </button>

          <button
            onClick={onToggleRoute}
            className={`action-btn ${showRoute ? 'btn-active' : 'btn-secondary'}`}
            title="Afficher/masquer les tracés et arrêts des lignes"
          >
            <Radio size={15} />
            <span className="btn-label">Tracés</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="action-btn btn-primary"
            title="Actualiser les positions maintenant"
          >
            <RefreshCw size={15} className={loading ? 'spinning' : ''} />
            <span className="btn-label">{loading ? '...' : `${countdown}s`}</span>
          </button>
        </div>
      </div>

      {/* Barre des lignes actives & suggestions */}
      <ActiveLinesBar
        activeLines={activeLines}
        buses={buses}
        onRemoveLine={onRemoveLine}
        onQuickAddLine={onAddLine}
        popularSuggestions={popularSuggestions}
      />
    </header>
  );
}
