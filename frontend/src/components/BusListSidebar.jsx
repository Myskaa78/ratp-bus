import React from 'react';
import { Bus, Navigation, Clock, ChevronRight, MapPin, Gauge } from 'lucide-react';

export default function BusListSidebar({
  buses = [],
  selectedBusId,
  onSelectBus,
  isOpen,
  onToggleOpen,
}) {
  return (
    <aside className={`bus-sidebar ${isOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      <div className="sidebar-header" onClick={onToggleOpen}>
        <div className="sidebar-header-title">
          <Bus size={18} className="text-teal-600" />
          <span>Bus en circulation ({buses.length})</span>
        </div>
        <button
          className="sidebar-toggle-btn"
          aria-label={isOpen ? 'Masquer le volet' : 'Ouvrir le volet'}
        >
          {isOpen ? '◀' : '▶'}
        </button>
      </div>

      {isOpen && (
        <div className="sidebar-content">
          {buses.length === 0 ? (
            <div className="sidebar-empty">
              <p>Aucun bus détecté pour le filtre actuel.</p>
            </div>
          ) : (
            <div className="bus-cards-list">
              {buses.map((bus) => {
                const isSelected = bus.id === selectedBusId;
                const isToRobinson = (bus.destination || '').toLowerCase().includes('robinson');

                return (
                  <div
                    key={bus.id}
                    className={`bus-card ${isSelected ? 'bus-card-selected' : ''}`}
                    onClick={() => onSelectBus(bus)}
                  >
                    <div className="bus-card-top">
                      <span className={`direction-tag ${isToRobinson ? 'tag-robinson' : 'tag-orleans'}`}>
                        {isToRobinson ? 'Vers Robinson RER' : "Vers Porte d'Orléans"}
                      </span>
                      <span className="bus-card-id">{bus.id}</span>
                    </div>

                    <div className="bus-card-dest">
                      <strong>{bus.destination}</strong>
                    </div>

                    <div className="bus-card-meta">
                      <span className="meta-item">
                        <Clock size={12} />
                        {bus.delay || "À l'heure"}
                      </span>
                      {bus.speed_kmh !== null && (
                        <span className="meta-item">
                          <Gauge size={12} />
                          {Math.round(bus.speed_kmh)} km/h
                        </span>
                      )}
                      {bus.bearing !== null && (
                        <span className="meta-item">
                          <Navigation size={12} />
                          {Math.round(bus.bearing)}°
                        </span>
                      )}
                    </div>

                    <div className="bus-card-action">
                      <MapPin size={12} />
                      <span>Centrer sur la carte</span>
                      <ChevronRight size={14} className="ml-auto" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

