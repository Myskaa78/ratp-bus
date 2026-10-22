import React from 'react';
import { MapPin, X, Clock, Navigation, Crosshair, Radio, Gauge } from 'lucide-react';

export default function TrackedStopCard({
  trackedStop,
  arrivals = [],
  loadingArrivals,
  onClose,
  onCenterStop,
}) {
  if (!trackedStop) return null;

  return (
    <div className="tracked-stop-floating-card">
      <div className="stop-card-header">
        <div className="stop-card-title-group">
          <div className="stop-radar-icon">
            <Radio size={16} className="text-teal-600 animate-pulse" />
          </div>
          <div>
            <div className="stop-card-badge">Arrêt en suivi actif</div>
            <h3 className="stop-card-name">{trackedStop.name}</h3>
            <span className="stop-card-commune">{trackedStop.commune || 'Île-de-France'}</span>
          </div>
        </div>

        <div className="stop-card-header-actions">
          <button
            onClick={onCenterStop}
            className="stop-action-icon-btn"
            title="Centrer la carte sur cet arrêt"
          >
            <Crosshair size={15} />
          </button>
          <button
            onClick={onClose}
            className="stop-action-icon-btn"
            title="Ne plus suivre cet arrêt"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="stop-card-body">
        <div className="arrivals-title">
          <Clock size={13} />
          <span>Prochains passages estimés en temps réel :</span>
        </div>

        {loadingArrivals && arrivals.length === 0 ? (
          <div className="arrivals-loading">Calcul des arrivées en cours...</div>
        ) : arrivals.length === 0 ? (
          <div className="arrivals-empty">
            Aucun bus actuellement en approche sur les lignes suivies (rayon 8 km).
          </div>
        ) : (
          <div className="arrivals-list">
            {arrivals.map((arr, idx) => {
              const isUrgent = arr.eta_minutes <= 3;
              const formattedDist =
                arr.distance_meters > 1000
                  ? `${(arr.distance_meters / 1000).toFixed(1)} km`
                  : `${arr.distance_meters} m`;

              return (
                <div
                  key={`${arr.vehicle_id}-${idx}`}
                  className={`arrival-item ${isUrgent ? 'arrival-urgent' : ''}`}
                >
                  <div
                    className="arrival-line-badge"
                    style={{ backgroundColor: arr.line_color || '#009E94' }}
                  >
                    {arr.line}
                  </div>

                  <div className="arrival-info">
                    <div className="arrival-dest">{arr.destination}</div>
                    <div className="arrival-sub">
                      <span>{formattedDist}</span>
                      {arr.speed_kmh && (
                        <span>• {Math.round(arr.speed_kmh)} km/h</span>
                      )}
                      <span>• Réf: {arr.vehicle_id}</span>
                    </div>
                  </div>

                  <div className="arrival-eta">
                    <span className={`eta-pill ${isUrgent ? 'eta-imminent' : 'eta-standard'}`}>
                      {arr.eta_minutes <= 1 ? 'À l’approche' : `Dans ${arr.eta_minutes} min`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="stop-card-footer">
        <span className="live-dot-pulse"></span>
        <span>Estimation en continu recalculée toutes les 10 secondes</span>
      </div>
    </div>
  );
}

