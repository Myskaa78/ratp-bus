import React, { useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Popup,
  useMap,
  ZoomControl,
  GeoJSON,
} from 'react-leaflet';
import L from 'leaflet';
import AnimatedBusMarker from './AnimatedBusMarker';
import { Target } from 'lucide-react';

export const FONTENAY_CENTER = [48.789, 2.288];
export const DEFAULT_ZOOM = 15;

/**
 * Création de l'icône de balise pour l'arrêt en cours de suivi
 */
function createTrackedBeaconIcon() {
  const html = `
    <div class="tracked-stop-marker-wrapper">
      <div class="beacon-pulse-wave"></div>
      <div class="beacon-pulse-wave-delayed"></div>
      <div class="beacon-pin">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="#E11D48" stroke="#FFFFFF" stroke-width="2">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          <circle cx="12" cy="9" r="2.5" fill="#FFFFFF"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-beacon-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 36],
    popupAnchor: [0, -36],
  });
}

const beaconIcon = createTrackedBeaconIcon();

/**
 * Contrôleur interne permettant de déplacer la caméra de la carte
 */
function MapController({ targetPos, zoom, fitBuses, buses }) {
  const map = useMap();

  useEffect(() => {
    if (targetPos) {
      map.flyTo(targetPos, zoom || 15, {
        duration: 1.2,
        easeLinearity: 0.25,
      });
    }
  }, [targetPos, zoom, map]);

  useEffect(() => {
    if (fitBuses && buses && buses.length > 0) {
      const bounds = L.latLngBounds(buses.map((b) => [b.latitude, b.longitude]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [fitBuses, buses, map]);

  return null;
}

export default function MapView({
  buses = [],
  activeLines = [],
  selectedBusId = null,
  onSelectBus,
  trackedStop = null,
  onSelectStop,
  targetCenter = null,
  showRoute = true,
}) {
  const mapRef = useRef(null);

  return (
    <div className="map-wrapper">
      <MapContainer
        center={FONTENAY_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        className="leaflet-map-canvas"
        ref={mapRef}
      >
        <ZoomControl position="bottomright" />
        <MapController targetPos={targetCenter} buses={buses} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | RATP / IDFM PRIM'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Tracé OFFICIEL des rues et voies de chaque ligne active (GeoJSON IDFM officiel) */}
        {showRoute &&
          activeLines.map((line) => {
            const lineColor = line.color || '#009E94';
            const stops = line.stops || [];

            return (
              <React.Fragment key={`route-group-${line.id_line || line.shortname}`}>
                {/* 1. Tracé officiel le long des routes réelles (zéro zig-zag) */}
                {line.shape && (
                  <>
                    <GeoJSON
                      key={`shape-bg-${line.id_line || line.shortname}`}
                      data={line.shape}
                      style={{
                        color: '#FFFFFF',
                        weight: 6,
                        opacity: 0.85,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                    <GeoJSON
                      key={`shape-fg-${line.id_line || line.shortname}`}
                      data={line.shape}
                      style={{
                        color: lineColor,
                        weight: 4,
                        opacity: 0.9,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                  </>
                )}

                {/* 2. Arrêts individuels le long de la ligne (points cliquables sans traits parasites) */}
                {stops.map((stop) => {
                  const isThisTracked =
                    trackedStop &&
                    trackedStop.name === stop.name &&
                    Math.abs(trackedStop.lat - stop.lat) < 0.001;

                  if (isThisTracked) return null;

                  return (
                    <CircleMarker
                      key={`stop-${line.shortname}-${stop.id || stop.name}`}
                      center={[stop.lat, stop.lng]}
                      radius={4.5}
                      pathOptions={{
                        fillColor: '#FFFFFF',
                        fillOpacity: 1,
                        color: lineColor,
                        weight: 2,
                      }}
                      eventHandlers={{
                        click: () => {
                          onSelectStop({
                            ...stop,
                            line: line.shortname,
                            lineColor: lineColor,
                          });
                        },
                      }}
                    >
                      <Popup className="stop-popup">
                        <div className="stop-popup-content">
                          <div className="stop-popup-badge" style={{ backgroundColor: lineColor }}>
                            {line.mode === 'metro' ? 'M' : line.mode === 'tram' ? 'T' : 'Bus'} {line.shortname}
                          </div>
                          <div className="stop-popup-name">{stop.name}</div>
                          <div className="stop-popup-commune">{stop.commune}</div>
                          <button
                            className="stop-popup-track-btn"
                            onClick={() => {
                              onSelectStop({
                                ...stop,
                                line: line.shortname,
                                lineColor: lineColor,
                              });
                            }}
                          >
                            <Target size={12} /> Suivre cet arrêt
                          </button>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </React.Fragment>
            );
          })}

        {/* Marqueur balise clignotante pour l'arrêt actuellement suivi */}
        {trackedStop && (
          <Marker
            position={[trackedStop.lat, trackedStop.lng]}
            icon={beaconIcon}
            zIndexOffset={1000}
          >
            <Popup className="stop-popup" autoPan={false}>
              <div className="stop-popup-content">
                <div className="stop-popup-badge bg-rose-600 text-white">
                  Arrêt suivi
                </div>
                <div className="stop-popup-name">{trackedStop.name}</div>
                <div className="stop-popup-commune">{trackedStop.commune}</div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Marqueurs animés pour chaque véhicule réel en circulation */}
        {buses.map((bus) => (
          <AnimatedBusMarker
            key={bus.id}
            bus={bus}
            isSelected={bus.id === selectedBusId}
            onSelect={onSelectBus}
          />
        ))}
      </MapContainer>
    </div>
  );
}
