import React, { useEffect, useRef, useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Navigation, Clock, Gauge, MapPin } from 'lucide-react';

/**
 * Crée une icône SVG HTML personnalisée selon le mode de transport (Bus, Métro, Tram, RER)
 */
function createTransitDivIcon(bearing, destination, line, lineColor, mode = 'bus', isSelected = false) {
  const rotation = typeof bearing === 'number' ? bearing : 0;
  const badgeColor = lineColor || '#009E94';
  const lineNumber = line || '128';
  const transportMode = (mode || 'bus').toLowerCase();

  // Préfixe de mode (M pour Métro, T pour Tram, RER pour RER/Train, ou rien pour Bus)
  const modePrefix =
    transportMode === 'metro' ? 'M' :
    transportMode === 'tram' ? 'T' :
    transportMode === 'rail' ? 'RER' : '';

  const displayText = modePrefix ? `${modePrefix} ${lineNumber}` : lineNumber;

  // Corps vectoriel selon le mode
  const iconSvg = transportMode === 'metro' || transportMode === 'rail' ? `
    <!-- Rame de Métro / Train -->
    <rect x="11" y="13" width="22" height="22" rx="4" fill="${badgeColor}" />
    <rect x="14" y="15" width="16" height="7" rx="1.5" fill="#FFFFFF" />
    <circle cx="15.5" cy="14" r="1.3" fill="#FFE066" />
    <circle cx="28.5" cy="14" r="1.3" fill="#FFE066" />
    <rect x="13.5" y="25" width="5" height="5" rx="1" fill="#FFFFFF" opacity="0.9" />
    <rect x="25.5" y="25" width="5" height="5" rx="1" fill="#FFFFFF" opacity="0.9" />
  ` : transportMode === 'tram' ? `
    <!-- Rame de Tramway -->
    <rect x="12" y="13" width="20" height="23" rx="3.5" fill="${badgeColor}" />
    <rect x="14.5" y="15" width="15" height="6.5" rx="1.5" fill="#FFFFFF" />
    <circle cx="16" cy="14" r="1.2" fill="#FFE066" />
    <circle cx="28" cy="14" r="1.2" fill="#FFE066" />
    <!-- Pantographe supérieur -->
    <path d="M20,7 L24,7 L22,13" stroke="#222" stroke-width="1.5" fill="none" />
  ` : `
    <!-- Corps du bus classique -->
    <rect x="13" y="14" width="18" height="20" rx="3" fill="${badgeColor}" />
    <rect x="15" y="16" width="14" height="6" rx="1.5" fill="#FFFFFF" />
    <circle cx="16" cy="15" r="1.2" fill="#FFE066" />
    <circle cx="28" cy="15" r="1.2" fill="#FFE066" />
    <rect x="15" y="24" width="5" height="4" rx="1" fill="#FFFFFF" opacity="0.85" />
    <rect x="24" y="24" width="5" height="4" rx="1" fill="#FFFFFF" opacity="0.85" />
    <rect x="11.5" y="17" width="2" height="4" rx="1" fill="#222" />
    <rect x="30.5" y="17" width="2" height="4" rx="1" fill="#222" />
    <rect x="11.5" y="28" width="2" height="4" rx="1" fill="#222" />
    <rect x="30.5" y="28" width="2" height="4" rx="1" fill="#222" />
  `;

  const html = `
    <div class="bus-marker-container ${isSelected ? 'bus-selected' : ''}">
      <div class="bus-pulse-ring" style="border-color: ${badgeColor};"></div>
      <div class="bus-icon-body" style="transform: rotate(${rotation}deg);">
        <svg viewBox="0 0 44 44" width="38" height="38" class="bus-svg-shadow">
          <!-- Disque de fond -->
          <circle cx="22" cy="22" r="19" fill="#FFFFFF" stroke="${badgeColor}" stroke-width="2.5" />
          <!-- Flèche de cap directionnelle -->
          <polygon points="22,4 26,12 18,12" fill="${badgeColor}" />
          ${iconSvg}
        </svg>
      </div>
      <!-- Badge dynamique Ligne et Mode -->
      <div class="bus-line-badge" style="background-color: ${badgeColor}; font-size: ${displayText.length > 3 ? '9px' : '10px'};">
        ${displayText}
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-leaflet-bus-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

export default function AnimatedBusMarker({ bus, isSelected, onSelect }) {
  const markerRef = useRef(null);
  const animFrameRef = useRef(null);
  
  const targetLat = bus.latitude;
  const targetLng = bus.longitude;

  const [currentPos, setCurrentPos] = useState([targetLat, targetLng]);
  const prevPosRef = useRef([targetLat, targetLng]);

  useEffect(() => {
    const [startLat, startLng] = prevPosRef.current;
    const endLat = targetLat;
    const endLng = targetLng;

    if (Math.abs(startLat - endLat) < 0.000001 && Math.abs(startLng - endLng) < 0.000001) {
      return;
    }

    const duration = 2000;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const ease = 1 - Math.pow(1 - progress, 3);

      const lat = startLat + (endLat - startLat) * ease;
      const lng = startLng + (endLng - startLng) * ease;

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      }
      setCurrentPos([lat, lng]);

      if (progress < 1.0) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        prevPosRef.current = [endLat, endLng];
      }
    };

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [targetLat, targetLng]);

  const modeName =
    bus.mode === 'metro' ? 'Métro' :
    bus.mode === 'tram' ? 'Tram' :
    bus.mode === 'rail' ? 'RER / Train' : 'Bus';

  const icon = createTransitDivIcon(
    bus.bearing,
    bus.destination,
    bus.line,
    bus.line_color,
    bus.mode,
    isSelected
  );

  return (
    <Marker
      ref={markerRef}
      position={currentPos}
      icon={icon}
      eventHandlers={{
        click: () => {
          if (onSelect) onSelect(bus);
        },
      }}
    >
      <Popup className="bus-popup-custom" autoPan={false}>
        <div className="popup-card">
          <div className="popup-header">
            <span
              className="popup-line-pill"
              style={{ backgroundColor: bus.line_color || '#009E94' }}
            >
              {modeName} {bus.line}
            </span>
            <span className="popup-operator">{bus.operator || 'RATP'}</span>
            <span className="popup-badge-sim" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
              Direct IDFM
            </span>
          </div>

          <div className="popup-destination-section">
            <div className="popup-label">Destination :</div>
            <div className="popup-destination-name">{bus.destination}</div>
          </div>

          {bus.approaching_stop && (
            <div className="popup-approaching-stop">
              <span className="text-gray-500 text-xs">Arrêt approché :</span>
              <strong className="text-xs text-teal-800 ml-1">{bus.approaching_stop}</strong>
            </div>
          )}

          <div className="popup-grid">
            <div className="popup-stat">
              <span className="stat-label"><Navigation size={12} /> Cap</span>
              <span className="stat-value">{bus.bearing !== null ? `${Math.round(bus.bearing)}°` : 'Suivi ligne'}</span>
            </div>

            <div className="popup-stat">
              <span className="stat-label"><Gauge size={12} /> Statut</span>
              <span className="stat-value text-emerald-700">En circulation</span>
            </div>

            <div className="popup-stat">
              <span className="stat-label"><Clock size={12} /> Ponctualité</span>
              <span className="stat-value font-mono text-emerald-600">{bus.delay || "À l'heure"}</span>
            </div>

            <div className="popup-stat">
              <span className="stat-label"><MapPin size={12} /> Réf Course</span>
              <span className="stat-value font-mono text-xs">{bus.id}</span>
            </div>
          </div>

          <div className="popup-footer">
            <div className="popup-coords">
              GPS : {bus.latitude.toFixed(5)}, {bus.longitude.toFixed(5)}
            </div>
            <div className="popup-time">
              Reçu à : {new Date(bus.recorded_at).toLocaleTimeString('fr-FR')}
            </div>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
