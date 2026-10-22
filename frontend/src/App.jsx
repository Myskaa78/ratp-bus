import React, { useState, useEffect, useRef, useCallback } from 'react';
import MapView, { FONTENAY_CENTER, DEFAULT_ZOOM } from './components/MapView';
import Header from './components/Header';
import BusListSidebar from './components/BusListSidebar';
import TrackedStopCard from './components/TrackedStopCard';
import { AlertTriangle, Key, ExternalLink, Info } from 'lucide-react';
import './App.css';

export default function App() {
  // Lignes suivies sur la carte (par défaut : Ligne 128)
  const [activeLines, setActiveLines] = useState([
    {
      id_line: 'C01157',
      line_ref: 'STIF:Line::C01157:',
      shortname: '128',
      name: "Porte d'Orléans ↔ Robinson RER",
      mode: 'bus',
      operator: 'RATP',
      color: '#009E94',
      destinations: ['Robinson RER', "Porte d'Orléans"],
      stops: [],
      shape: null,
    },
  ]);

  const [catalogLines, setCatalogLines] = useState([]);
  const [buses, setBuses] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [countdown, setCountdown] = useState(10);

  const [selectedBusId, setSelectedBusId] = useState(null);
  const [targetCenter, setTargetCenter] = useState(null);

  // Arrêt actuellement tracké
  const [trackedStop, setTrackedStop] = useState(null);
  const [stopArrivals, setStopArrivals] = useState([]);
  const [loadingArrivals, setLoadingArrivals] = useState(false);

  // Interface utilisateur
  const [showRoute, setShowRoute] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showApiKeyGuide, setShowApiKeyGuide] = useState(false);

  // 1. Charger les arrêts initiaux, le catalogue et le tracé officiel de la ligne 128
  useEffect(() => {
    async function initApp() {
      try {
        const [linesRes, shape128Res, stops128Res] = await Promise.all([
          fetch('/api/lines'),
          fetch('/api/lines/128/shape'),
          fetch('/api/lines/128/stops'),
        ]);

        let initial128 = {
          id_line: 'C01157',
          line_ref: 'STIF:Line::C01157:',
          shortname: '128',
          name: "Porte d'Orléans ↔ Robinson RER",
          mode: 'bus',
          operator: 'RATP',
          color: '#009E94',
          stops: [],
          shape: null,
        };

        if (linesRes.ok) {
          const lines = await linesRes.json();
          setCatalogLines(lines);
          const found = lines.find((l) => l.shortname === '128');
          if (found) initial128 = { ...found, shape: null };
        }

        if (shape128Res.ok) {
          const shapeData = await shape128Res.json();
          initial128.shape = shapeData.shape;
        }

        if (stops128Res.ok) {
          initial128.stops = await stops128Res.json();
        }

        setActiveLines([initial128]);
      } catch (err) {
        console.warn('Erreur initialisation lignes et tracés:', err);
      }
    }
    initApp();
  }, []);

  // 2. Récupérer les véhicules en temps réel pour toutes les lignes actives
  const fetchBusPositions = useCallback(async (isManual = false, overrideLines = null) => {
    if (isManual) setLoading(true);

    try {
      const linesList = overrideLines || activeLines;
      const lineCodes = linesList.map((l) => l.id_line || l.shortname).join(',');
      const url = `/api/buses?lines=${encodeURIComponent(lineCodes || '128')}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status} reçue du proxy`);
      }

      const data = await response.json();
      setMetadata(data);
      setBuses(data.buses || []);
      setNetworkError(null);
      setCountdown(10);
    } catch (err) {
      console.warn('Erreur lors du rafraîchissement des positions:', err);
      setNetworkError(
        'Impossible de joindre le backend Python. Assurez-vous que le serveur FastAPI est démarré sur http://localhost:8000'
      );
    } finally {
      setLoading(false);
    }
  }, [activeLines]);

  // 3. Récupérer les prochains passages réels pour l'arrêt sélectionné
  const fetchStopArrivals = useCallback(async () => {
    if (!trackedStop) return;
    setLoadingArrivals(true);

    try {
      const lineCodes = activeLines.map((l) => l.id_line || l.shortname).join(',');
      const stopParam = trackedStop.id ? `&stop_id=${encodeURIComponent(trackedStop.id)}` : '';
      const url = `/api/stops/${encodeURIComponent(trackedStop.name)}/arrivals?lat=${trackedStop.lat}&lng=${trackedStop.lng}&lines=${encodeURIComponent(lineCodes || '128')}&commune=${encodeURIComponent(trackedStop.commune || '')}${stopParam}`;
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setStopArrivals(data.arrivals || []);
      }
    } catch (err) {
      console.warn('Erreur estimation arrêts:', err);
    } finally {
      setLoadingArrivals(false);
    }
  }, [trackedStop, activeLines]);

  // Polling automatique toutes les 10 secondes
  useEffect(() => {
    fetchBusPositions();
    if (trackedStop) {
      fetchStopArrivals();
    }

    const pollInterval = setInterval(() => {
      fetchBusPositions();
      if (trackedStop) {
        fetchStopArrivals();
      }
    }, 10000);

    const timerInterval = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 10 : prev - 1));
    }, 1000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
    };
  }, [fetchBusPositions, fetchStopArrivals, trackedStop]);

  // Ajouter une ligne au suivi avec récupération de son tracé officiel GeoJSON et de ses arrêts
  const handleAddLine = async (line) => {
    const isAlready = activeLines.some(
      (l) => l.id_line === line.id_line || l.shortname === line.shortname
    );
    if (isAlready) return;

    let lineComplete = { ...line, stops: line.stops || [], shape: null };
    const ident = line.id_line || line.shortname;

    try {
      const [stopsRes, shapeRes] = await Promise.all([
        fetch(`/api/lines/${ident}/stops`),
        fetch(`/api/lines/${ident}/shape`),
      ]);

      if (stopsRes.ok) {
        lineComplete.stops = await stopsRes.json();
      }
      if (shapeRes.ok) {
        const shapeData = await shapeRes.json();
        lineComplete.shape = shapeData.shape;
      }
    } catch (e) {
      console.warn('Erreur chargement compléments ligne:', ident, e);
    }

    const newActiveLines = [...activeLines, lineComplete];
    setActiveLines(newActiveLines);

    // Lancement immédiat de la détection des bus/métros en live
    fetchBusPositions(true, newActiveLines);

    // Centrage sur le premier arrêt de la ligne
    if (lineComplete.stops && lineComplete.stops.length > 0) {
      const firstStop = lineComplete.stops[0];
      setTargetCenter([firstStop.lat, firstStop.lng]);
    }
  };

  // Retirer une ligne du suivi
  const handleRemoveLine = (identifier) => {
    if (activeLines.length <= 1) return;
    const newLines = activeLines.filter(
      (l) => l.shortname !== identifier && l.id_line !== identifier
    );
    setActiveLines(newLines);
    fetchBusPositions(true, newLines);
  };

  // Sélectionner / tracker un arrêt
  const handleSelectStop = (stop) => {
    setTrackedStop(stop);
    setSelectedBusId(null);
    setTargetCenter([stop.lat, stop.lng]);

    if (stop.lines && stop.lines.length > 0) {
      const lineShortname = stop.lines[0];
      const known = catalogLines.find((c) => c.shortname === lineShortname);
      if (known && !activeLines.some((a) => a.shortname === lineShortname)) {
        handleAddLine(known);
      }
    }
  };

  const handleCenterFontenay = () => {
    setSelectedBusId(null);
    setTargetCenter([...FONTENAY_CENTER]);
  };

  const popularSuggestions = [
    { shortname: '4', name: 'Métro 4 (Porte de Clignancourt ↔ Bagneux)', color: '#CF009E', mode: 'metro' },
    { shortname: 'T6', name: 'Tram T6 (Châtillon-Montrouge ↔ Viroflay)', color: '#FF0000', mode: 'tram' },
    { shortname: '13', name: 'Métro 13 (Châtillon-Montrouge ↔ St-Denis/Gennevilliers)', color: '#82C8E6', mode: 'metro' },
    { shortname: '394', name: 'Bus 394 (Bourg-la-Reine ↔ Issy-Val de Seine)', color: '#640082', mode: 'bus' },
    { shortname: '194', name: 'Bus 194 (Porte d’Orléans ↔ Châtenay)', color: '#EB7300', mode: 'bus' },
  ].filter((sug) => !activeLines.some((al) => al.shortname === sug.shortname));

  return (
    <div className="app-container">
      {/* En-tête avec Recherche universelle (Lignes / Métro / Arrêts), filtres et état */}
      <Header
        metadata={metadata}
        loading={loading}
        onRefresh={() => {
          fetchBusPositions(true);
          if (trackedStop) fetchStopArrivals();
        }}
        countdown={countdown}
        totalBuses={buses.length}
        activeLines={activeLines}
        buses={buses}
        onAddLine={handleAddLine}
        onRemoveLine={handleRemoveLine}
        onSelectStop={handleSelectStop}
        onCenterFontenay={handleCenterFontenay}
        showRoute={showRoute}
        onToggleRoute={() => setShowRoute(!showRoute)}
        onOpenApiKeyGuide={() => setShowApiKeyGuide(true)}
        popularSuggestions={popularSuggestions}
      />

      {/* Alerte si la clé API PRIM est manquante */}
      {metadata?.status === 'missing_key' && (
        <div className="api-key-banner">
          <Key size={16} className="flex-shrink-0" />
          <div className="banner-text">
            <strong>Flux temps réel officiel :</strong> Renseignez votre clé API PRIM dans <code>backend/.env</code> pour recevoir la géolocalisation des véhicules.
          </div>
          <button
            className="banner-guide-btn"
            onClick={() => setShowApiKeyGuide(true)}
          >
            Obtenir ma clé PRIM
          </button>
        </div>
      )}

      {/* Alerte d'erreur réseau */}
      {networkError && (
        <div className="network-alert-banner">
          <AlertTriangle size={18} className="flex-shrink-0" />
          <div className="alert-content">
            <strong>Erreur de communication :</strong> {networkError}
          </div>
          <button onClick={() => fetchBusPositions(true)} className="alert-retry-btn">
            Réessayer
          </button>
        </div>
      )}

      {/* Message d'info si aucun véhicule en circulation */}
      {metadata?.status === 'no_data' && (
        <div className="info-strip">
          <Info size={15} />
          <span>{metadata.message}</span>
        </div>
      )}

      {/* Modal d'aide Clé API PRIM */}
      {showApiKeyGuide && (
        <div className="api-key-modal-overlay">
          <div className="api-key-guide-card">
            <div className="guide-header">
              <h3>🔑 Clé API PRIM (Île-de-France Mobilités)</h3>
              <button className="close-guide-btn" onClick={() => setShowApiKeyGuide(false)}>
                ✕
              </button>
            </div>
            <div className="guide-body">
              <ol className="guide-steps">
                <li>
                  Rendez-vous sur{' '}
                  <a
                    href="https://prim.iledefrance-mobilites.fr"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-link"
                  >
                    prim.iledefrance-mobilites.fr <ExternalLink size={12} />
                  </a>.
                </li>
                <li>Connectez-vous et allez dans <em>Mon profil &gt; Mes jetons d'authentification</em>.</li>
                <li>Générez un jeton et copiez-le dans <code>backend/.env</code> :
                  <pre className="code-snippet">IDFM_API_KEY=votre_cle_ici</pre>
                </li>
              </ol>
            </div>
            <div className="guide-footer">
              <button className="btn-primary" onClick={() => setShowApiKeyGuide(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Espace Principal de Navigation */}
      <main className="main-content">
        <MapView
          buses={buses}
          activeLines={activeLines}
          selectedBusId={selectedBusId}
          onSelectBus={(bus) => {
            setSelectedBusId(bus.id);
            setTargetCenter([bus.latitude, bus.longitude]);
          }}
          trackedStop={trackedStop}
          onSelectStop={handleSelectStop}
          targetCenter={targetCenter}
          showRoute={showRoute}
        />

        {/* Volet latéral des véhicules réels en circulation */}
        <BusListSidebar
          buses={buses}
          selectedBusId={selectedBusId}
          onSelectBus={(bus) => {
            setSelectedBusId(bus.id);
            setTargetCenter([bus.latitude, bus.longitude]);
          }}
          isOpen={isSidebarOpen}
          onToggleOpen={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        {/* Carte de suivi de l'arrêt sélectionné avec temps d'attente réel */}
        <TrackedStopCard
          trackedStop={trackedStop}
          arrivals={stopArrivals}
          loadingArrivals={loadingArrivals}
          onClose={() => {
            setTrackedStop(null);
            setStopArrivals([]);
          }}
          onCenterStop={() => {
            if (trackedStop) {
              setTargetCenter([trackedStop.lat, trackedStop.lng]);
            }
          }}
        />
      </main>
    </div>
  );
}
