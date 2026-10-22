import os
import time
import math
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from catalog import DEFAULT_LINES

# Rechargement dynamique du fichier .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ratp-multiline-realtime")

# ==============================================================================
# CONFIGURATION OFFICIELLE API PRIM (Île-de-France Mobilités)
# ==============================================================================
PRIM_BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace"
PRIM_STOP_MONITORING_URL = f"{PRIM_BASE_URL}/stop-monitoring"
PRIM_ESTIMATED_TIMETABLE_URL = f"{PRIM_BASE_URL}/estimated-timetable"
PRIM_VEHICLE_MONITORING_URL = f"{PRIM_BASE_URL}/vehicle-monitoring"

IDFM_OPEN_DATA_LINES_URL = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/records"
IDFM_OPEN_DATA_STOPS_URL = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/records"
IDFM_OPEN_DATA_SHAPES_URL = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/traces-des-lignes-de-transport-en-commun-idfm/records"

# Base de données en mémoire des arrêts, tracés géométriques et lignes
stops_coords_db: Dict[str, Dict[str, Any]] = {}
shapes_cache: Dict[str, Any] = {}
lines_registry_cache: Dict[str, Dict[str, Any]] = {}
search_cache: Dict[str, Any] = {}

def get_api_key() -> str:
    """Récupère la clé API en rechargeant le fichier .env en direct."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(dotenv_path=env_path, override=True)
    key = os.getenv("IDFM_API_KEY", "").strip()
    return key if key and key != "YOUR_IDFM_API_KEY" else ""

# ==============================================================================
# MODÈLES PYDANTIC (100% TEMPS RÉEL)
# ==============================================================================
class BusPosition(BaseModel):
    id: str
    line: str
    line_ref: str
    line_color: str = "#009E94"
    mode: str = "bus"  # "bus", "metro", "tram", "rail"
    operator: str
    destination: str
    direction: str
    latitude: float
    longitude: float
    bearing: Optional[float] = None
    speed_kmh: Optional[float] = None
    recorded_at: str
    delay: Optional[str] = None
    approaching_stop: Optional[str] = None

class StopItem(BaseModel):
    id: str
    name: str
    commune: str
    lat: float
    lng: float
    lines: List[str] = []

class LineItem(BaseModel):
    id_line: str
    line_ref: str
    shortname: str
    name: str
    mode: str = "bus"
    operator: str = "RATP"
    color: str = "#009E94"
    text_color: str = "#ffffff"
    destinations: List[str] = []
    stops: List[StopItem] = []

class ApiResponse(BaseModel):
    status: str
    source: str = "prim_live"
    message: str
    count: int
    lines: List[str]
    buses: List[BusPosition]
    server_time: str

class NextArrival(BaseModel):
    line: str
    line_color: str
    destination: str
    eta_minutes: int
    expected_time: Optional[str] = None
    distance_meters: Optional[int] = None
    vehicle_id: Optional[str] = None
    status: str = "live"

class StopArrivalsResponse(BaseModel):
    stop_name: str
    commune: Optional[str] = None
    stop_lat: float
    stop_lng: float
    arrivals: List[NextArrival]
    tracked_lines: List[str]
    source: str = "prim_live"
    message: str
    timestamp: str

# ==============================================================================
# RÉSOLUTION DYNAMIQUE UNIVERSELLE DE LIGNES (BUS, MÉTRO, TRAM, RER)
# ==============================================================================
def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c

def extract_text(data: Any, default: str = "") -> str:
    if not data:
        return default
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        return str(data.get("value", data.get("Value", default)))
    if isinstance(data, list) and len(data) > 0:
        return extract_text(data[0], default)
    return str(data)

async def resolve_line_info(identifier: str, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
    """
    Résout n'importe quel identifiant de ligne (ex: '4', '13', 'B', 'T6', '128', '394', 'C01374')
    en son objet officiel IDFM avec l'identifiant technique LineRef exact.
    """
    ident_clean = identifier.strip()
    if not ident_clean:
        return None

    # 1. Vérifier le cache en mémoire
    if ident_clean.lower() in lines_registry_cache:
        return lines_registry_cache[ident_clean.lower()]

    # 2. Vérifier dans le catalogue local
    for l in DEFAULT_LINES:
        if (
            l["shortname"].lower() == ident_clean.lower()
            or l["id_line"].lower() == ident_clean.lower()
            or l["line_ref"].lower() == ident_clean.lower()
        ):
            info = {
                "id_line": l["id_line"],
                "line_ref": l["line_ref"],
                "shortname": l["shortname"],
                "name": l["name"],
                "mode": l.get("mode", "bus"),
                "operator": l.get("operator", "RATP"),
                "color": l.get("color", "#009E94"),
                "destinations": l.get("destinations", []),
            }
            lines_registry_cache[ident_clean.lower()] = info
            lines_registry_cache[l["id_line"].lower()] = info
            lines_registry_cache[l["shortname"].lower()] = info
            return info

    # 3. Interroger l'API Open Data officielle d'Île-de-France Mobilités
    try:
        url = (
            f'{IDFM_OPEN_DATA_LINES_URL}?where='
            f'(id_line%3D%22{ident_clean}%22%20or%20shortname_line%3D%22{ident_clean}%22)%20and%20status%3D%22active%22'
            f'&order_by=id_line&limit=5'
        )
        r = await client.get(url)
        if r.status_code == 200:
            results = [
                x for x in r.json().get("results", [])
                if "remplacement" not in (x.get("name_line") or "").lower()
            ]
            if not results:
                results = r.json().get("results", [])

            if results:
                res = results[0]
                color = res.get("colourweb_hexa") or "009E94"
                if not color.startswith("#"):
                    color = f"#{color}"

                id_line = res.get("id_line")
                shortname = res.get("shortname_line") or ident_clean
                mode = res.get("transportmode", "bus")
                operator = res.get("operatorname", "RATP")
                name = res.get("name_line") or f"Ligne {shortname}"

                info = {
                    "id_line": id_line,
                    "line_ref": f"STIF:Line::{id_line}:",
                    "shortname": shortname,
                    "name": name,
                    "mode": mode,
                    "operator": operator,
                    "color": color,
                    "destinations": [],
                }

                lines_registry_cache[ident_clean.lower()] = info
                lines_registry_cache[id_line.lower()] = info
                lines_registry_cache[shortname.lower()] = info
                return info
    except Exception as e:
        logger.warning(f"Erreur résolution dynamique de ligne pour '{ident_clean}': {e}")

    # Repli générique
    clean_code = ident_clean.replace("STIF:Line::", "").replace(":", "")
    fallback = {
        "id_line": clean_code,
        "line_ref": f"STIF:Line::{clean_code}:" if not ident_clean.startswith("STIF") else ident_clean,
        "shortname": clean_code,
        "name": f"Ligne {clean_code}",
        "mode": "bus",
        "operator": "RATP/IDFM",
        "color": "#009E94",
        "destinations": [],
    }
    return fallback

async def prefetch_line_stops(id_line: str, shortname: str, client: httpx.AsyncClient):
    """Charge les arrêts réels d'une ligne dans le dictionnaire stops_coords_db."""
    try:
        url = (
            f"{IDFM_OPEN_DATA_STOPS_URL}?where="
            f'id%20like%20%22%25{id_line}%22%20or%20shortname%3D%22{shortname}%22&limit=100'
        )
        r = await client.get(url)
        if r.status_code == 200:
            for item in r.json().get("results", []):
                raw_id = item.get("stop_id", "").replace("IDFM:", "").strip()
                stops_coords_db[raw_id] = {
                    "name": item.get("stop_name"),
                    "commune": item.get("nom_commune", ""),
                    "lat": float(item.get("stop_lat")),
                    "lng": float(item.get("stop_lon")),
                    "line": shortname,
                }
    except Exception as e:
        logger.debug(f"Prefetch arrêts pour {shortname}: {e}")

async def fetch_line_shape(id_line: str, shortname: str, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
    """Récupère le tracé vectoriel officiel GeoJSON (rues et voies réelles) pour une ligne donnée."""
    cache_key = f"{id_line.lower()}_{shortname.lower()}"
    if cache_key in shapes_cache:
        return shapes_cache[cache_key]

    clean_id = id_line.replace("STIF:Line::", "").replace(":", "")
    try:
        url = (
            f"{IDFM_OPEN_DATA_SHAPES_URL}?where="
            f'id_ilico%3D%22{clean_id}%22%20or%20route_short_name%3D%22{shortname}%22&limit=1'
        )
        r = await client.get(url)
        if r.status_code == 200:
            results = r.json().get("results", [])
            if results:
                shape = results[0].get("shape")
                if shape:
                    shapes_cache[cache_key] = shape
                    shapes_cache[clean_id.lower()] = shape
                    shapes_cache[shortname.lower()] = shape
                    return shape
    except Exception as e:
        logger.warning(f"Erreur récupération tracé officiel pour {shortname}: {e}")

    return None

# ==============================================================================
# LIFECYCLE DE L'APPLICATION
# ==============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initialisation de la base des arrêts, tracés et lignes réelles IDFM...")
    async with httpx.AsyncClient(timeout=6.0) as client:
        for l in DEFAULT_LINES:
            await prefetch_line_stops(l["id_line"], l["shortname"], client)
            await fetch_line_shape(l["id_line"], l["shortname"], client)
            lines_registry_cache[l["shortname"].lower()] = l
            lines_registry_cache[l["id_line"].lower()] = l
    logger.info(f"Base initialisée ({len(stops_coords_db)} arrêts géolocalisés, {len(shapes_cache)} tracés officiels).")
    yield

app = FastAPI(
    title="RATP Pure Realtime Multi-Modal Tracker",
    description="Backend 100% temps réel branché directement sur l'API PRIM d'Île-de-France Mobilités pour Bus, Métro, Tram et RER.",
    version="3.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# ROUTES API
# ==============================================================================

@app.get("/api/health")
def health_check():
    key = get_api_key()
    return {
        "status": "healthy",
        "has_api_key": bool(key),
        "api_key_length": len(key) if key else 0,
        "mode": "100_percent_pure_live",
        "stops_indexed": len(stops_coords_db),
        "server_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

@app.get("/api/lines", response_model=List[LineItem])
def get_catalog_lines():
    output = []
    for line in DEFAULT_LINES:
        stops = [
            StopItem(
                id=s["id"],
                name=s["name"],
                commune=s["commune"],
                lat=s["lat"],
                lng=s["lng"],
                lines=[line["shortname"]],
            )
            for s in line.get("stops", [])
        ]
        output.append(
            LineItem(
                id_line=line["id_line"],
                line_ref=line["line_ref"],
                shortname=line["shortname"],
                name=line["name"],
                mode=line.get("mode", "bus"),
                operator=line.get("operator", "RATP"),
                color=line.get("color", "#009E94"),
                text_color=line.get("text_color", "#ffffff"),
                destinations=line.get("destinations", []),
                stops=stops,
            )
        )
    return output

@app.get("/api/lines/{line_id}/stops", response_model=List[StopItem])
async def get_line_stops(line_id: str):
    async with httpx.AsyncClient(timeout=5.0) as client:
        line_info = await resolve_line_info(line_id, client)
        if not line_info:
            return []

        # Chercher les arrêts de cette ligne
        try:
            id_line = line_info["id_line"]
            shortname = line_info["shortname"]
            url = f"{IDFM_OPEN_DATA_STOPS_URL}?where=id%20like%20%22%25{id_line}%22%20or%20shortname%3D%22{shortname}%22&limit=80"
            r = await client.get(url)
            if r.status_code == 200:
                results = r.json().get("results", [])
                stops = []
                seen = set()
                for item in results:
                    s_name = item.get("stop_name", "")
                    if s_name in seen:
                        continue
                    seen.add(s_name)
                    raw_id = item.get("stop_id", "").replace("IDFM:", "").strip()
                    lat_f = float(item.get("stop_lat", 48.789))
                    lng_f = float(item.get("stop_lon", 2.288))

                    # Mettre aussi à jour stops_coords_db
                    stops_coords_db[raw_id] = {
                        "name": s_name,
                        "commune": item.get("nom_commune", "Île-de-France"),
                        "lat": lat_f,
                        "lng": lng_f,
                        "line": shortname,
                    }

                    stops.append(
                        StopItem(
                            id=raw_id,
                            name=s_name,
                            commune=item.get("nom_commune", "Île-de-France"),
                            lat=lat_f,
                            lng=lng_f,
                            lines=[shortname],
                        )
                    )
                return stops
        except Exception as e:
            logger.warning(f"Erreur arrêts pour {line_id}: {e}")

    return []

@app.get("/api/lines/{line_id}/shape")
async def get_line_shape_route(line_id: str):
    """Renvoie le tracé vectoriel officiel GeoJSON (rues et voies exactes) de la ligne."""
    async with httpx.AsyncClient(timeout=6.0) as client:
        info = await resolve_line_info(line_id, client)
        if not info:
            raise HTTPException(status_code=404, detail="Ligne non trouvée")

        shape = await fetch_line_shape(info["id_line"], info["shortname"], client)
        return {
            "id_line": info["id_line"],
            "shortname": info["shortname"],
            "color": info["color"],
            "mode": info.get("mode", "bus"),
            "shape": shape,
        }

@app.get("/api/search")
async def universal_search(q: str = Query(..., min_length=1, description="Nom de ligne ou d'arrêt")):
    query = q.strip()
    cache_key = query.lower()
    if cache_key in search_cache:
        return search_cache[cache_key]

    matched_lines = []
    matched_stops = []
    seen_stop_names = set()

    for line in DEFAULT_LINES:
        if (
            query.lower() in line["shortname"].lower()
            or query.lower() in line["name"].lower()
            or query.lower() in line["id_line"].lower()
        ):
            matched_lines.append({
                "type": "line",
                "id_line": line["id_line"],
                "line_ref": line["line_ref"],
                "shortname": line["shortname"],
                "name": line["name"],
                "mode": line.get("mode", "bus"),
                "operator": line.get("operator", "RATP"),
                "color": line.get("color", "#009E94"),
                "text_color": line.get("text_color", "#ffffff"),
                "destinations": line.get("destinations", []),
                "stops_count": len(line.get("stops", [])),
            })

    try:
        async with httpx.AsyncClient(timeout=3.5) as client:
            lines_url = (
                f'{IDFM_OPEN_DATA_LINES_URL}?where='
                f'(shortname_line%20like%20%22{query}%25%22%20or%20name_line%20like%20%22{query}%25%22)%20and%20status%3D%22active%22'
                f'&order_by=id_line&limit=6'
            )
            r_lines = await client.get(lines_url)
            if r_lines.status_code == 200:
                for r in r_lines.json().get("results", []):
                    lid = r.get("id_line")
                    if not any(l["id_line"] == lid for l in matched_lines):
                        color = f"#{r.get('colourweb_hexa', '009E94')}"
                        if not color.startswith("#"):
                            color = f"#{color}"

                        mode = r.get("transportmode", "bus")
                        s_name = r.get("shortname_line") or r.get("name_line")
                        prefix = "Métro" if mode == "metro" else "Tram" if mode == "tram" else "RER" if mode == "rail" else "Bus"

                        matched_lines.append({
                            "type": "line",
                            "id_line": lid,
                            "line_ref": f"STIF:Line::{lid}:",
                            "shortname": s_name,
                            "name": f"{prefix} {s_name} ({r.get('operatorname', 'RATP')})",
                            "mode": mode,
                            "operator": r.get("operatorname", "RATP"),
                            "color": color,
                            "text_color": "#ffffff",
                            "destinations": [],
                            "stops_count": 0,
                        })

            stops_url = f'{IDFM_OPEN_DATA_STOPS_URL}?where=search(stop_name,%20%22{query}%22)&limit=8'
            r_stops = await client.get(stops_url)
            if r_stops.status_code == 200:
                for s in r_stops.json().get("results", []):
                    s_name = s.get("stop_name", "")
                    commune = s.get("nom_commune", "Île-de-France")
                    stop_key = f"{s_name}-{commune}"
                    if stop_key not in seen_stop_names:
                        seen_stop_names.add(stop_key)
                        matched_stops.append({
                            "type": "stop",
                            "id": s.get("stop_id", "").replace("IDFM:", ""),
                            "name": s_name,
                            "commune": commune,
                            "lat": float(s.get("stop_lat", 48.789)),
                            "lng": float(s.get("stop_lon", 2.288)),
                            "lines": [s.get("shortname", "")],
                            "color": "#009E94",
                        })
    except Exception as e:
        logger.debug(f"Recherche distante: {e}")

    result = {
        "query": query,
        "lines": matched_lines[:6],
        "stops": matched_stops[:10],
    }
    search_cache[cache_key] = result
    return result

@app.get("/api/buses", response_model=ApiResponse)
async def get_buses(
    lines: Optional[str] = Query(default=None, description="Lignes séparées par virgules (ex: 128,4,394,T6)")
):
    """
    RÉCUPÉRATION 100% TEMPS RÉEL MULTI-LIGNES (BUS, MÉTRO, TRAM, RER) VIA PRIM IDFM.
    Résout automatiquement n'importe quelle ligne ajoutée par l'utilisateur et traque
    tous ses véhicules en circulation en direct.
    """
    api_key = get_api_key()

    if not api_key:
        return ApiResponse(
            status="missing_key",
            source="prim_live",
            message="Clé API PRIM manquante. Renseignez votre jeton dans backend/.env (IDFM_API_KEY=...) pour voir les véhicules en direct.",
            count=0,
            lines=[x.strip() for x in (lines or "128").split(",") if x.strip()],
            buses=[],
            server_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

    requested_lines_raw = [x.strip() for x in (lines or "128").split(",") if x.strip()]
    active_lines_info = []

    headers = {"apikey": api_key, "Accept": "application/json"}

    async with httpx.AsyncClient(timeout=9.0) as client:
        # 1. Résoudre chaque ligne (qu'il s'agisse de Bus, Métro, Tram ou RER)
        for item in requested_lines_raw:
            info = await resolve_line_info(item, client)
            if info:
                active_lines_info.append(info)
                # Précharger les arrêts de cette ligne si nécessaire
                await prefetch_line_stops(info["id_line"], info["shortname"], client)

        all_buses: List[BusPosition] = []
        error_msg = None

        # 2. Interroger l'API officielle PRIM pour chacune des lignes actives
        for l_info in active_lines_info:
            line_ref = l_info["line_ref"]
            shortname = l_info["shortname"]
            line_color = l_info["color"]
            mode = l_info.get("mode", "bus")
            operator = l_info.get("operator", "RATP")

            # 2.A : Tentative sur Vehicle Monitoring
            vm_found = False
            try:
                vm_url = f"{PRIM_VEHICLE_MONITORING_URL}?LineRef={line_ref}"
                r_vm = await client.get(vm_url, headers=headers)
                if r_vm.status_code == 200:
                    data_vm = r_vm.json()
                    siri = data_vm.get("Siri", data_vm)
                    deliv = siri.get("ServiceDelivery", siri).get("VehicleMonitoringDelivery", [])
                    if isinstance(deliv, dict):
                        deliv = [deliv]
                    for d in deliv:
                        acts = d.get("VehicleActivity", [])
                        if isinstance(acts, dict):
                            acts = [acts]
                        for act in acts:
                            j = act.get("MonitoredVehicleJourney", {})
                            loc = j.get("VehicleLocation", {})
                            lat = loc.get("Latitude")
                            lng = loc.get("Longitude")
                            if lat is not None and lng is not None:
                                all_buses.append(
                                    BusPosition(
                                        id=extract_text(j.get("VehicleRef"), f"{shortname}-{len(all_buses)+1}"),
                                        line=shortname,
                                        line_ref=line_ref,
                                        line_color=line_color,
                                        mode=mode,
                                        operator=extract_text(j.get("OperatorRef"), operator),
                                        destination=extract_text(j.get("DestinationName") or j.get("DirectionName"), "Direction"),
                                        direction=extract_text(j.get("DirectionName"), "Direction"),
                                        latitude=float(lat),
                                        longitude=float(lng),
                                        bearing=float(j.get("Bearing")) if j.get("Bearing") is not None else None,
                                        speed_kmh=None,
                                        recorded_at=act.get("RecordedAtTime", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
                                        delay=extract_text(j.get("Delay")),
                                    )
                                )
                                vm_found = True
            except Exception as e:
                logger.debug(f"VM request {line_ref}: {e}")

            # 2.B : Si Vehicle Monitoring n'a pas répondu, utiliser Estimated-Timetable
            if not vm_found:
                try:
                    et_url = f"{PRIM_ESTIMATED_TIMETABLE_URL}?LineRef={line_ref}"
                    r_et = await client.get(et_url, headers=headers)
                    if r_et.status_code == 200:
                        data_et = r_et.json()
                        delivery = data_et.get("Siri", {}).get("ServiceDelivery", {}).get("EstimatedTimetableDelivery", [])
                        if delivery:
                            frames = delivery[0].get("EstimatedJourneyVersionFrame", [])
                            if frames:
                                journeys = frames[0].get("EstimatedVehicleJourney", [])
                                logger.info(f"Ligne {shortname} ({mode}) : {len(journeys)} véhicules détectés en circulation.")

                                for idx, j in enumerate(journeys):
                                    calls = j.get("EstimatedCalls", {}).get("EstimatedCall", [])
                                    if not calls:
                                        continue
                                    first_call = calls[0]
                                    raw_ref = first_call.get("StopPointRef", {}).get("value", "")
                                    stop_id = raw_ref.replace("STIF:StopPoint:Q:", "").replace(":", "").strip()

                                    stop_info = stops_coords_db.get(stop_id)
                                    if stop_info:
                                        dest = extract_text(j.get("DestinationName") or j.get("DestinationShortName"), "Terminus")
                                        direction = extract_text(j.get("DirectionName"), dest)
                                        journey_ref = extract_text(j.get("DatedVehicleJourneyRef"), f"{shortname}-{idx+1}")
                                        status_val = first_call.get("DepartureStatus", "À l'heure")

                                        all_buses.append(
                                            BusPosition(
                                                id=journey_ref.split("::")[-1].replace(":LOC", "") if "::" in journey_ref else journey_ref,
                                                line=shortname,
                                                line_ref=line_ref,
                                                line_color=line_color,
                                                mode=mode,
                                                operator=operator,
                                                destination=dest,
                                                direction=direction,
                                                latitude=stop_info["lat"],
                                                longitude=stop_info["lng"],
                                                bearing=None,
                                                speed_kmh=None,
                                                recorded_at=j.get("RecordedAtTime", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
                                                delay=status_val if status_val != "ON_TIME" else "À l'heure",
                                                approaching_stop=f"{stop_info['name']} ({stop_info['commune']})" if stop_info.get("commune") else stop_info["name"],
                                            )
                                        )
                    elif r_et.status_code in (401, 403):
                        error_msg = f"Clé API PRIM invalide ou refusée (HTTP {r_et.status_code})."
                except Exception as e:
                    logger.error(f"Erreur Estimated-Timetable pour {line_ref}: {e}")
                    error_msg = str(e)

    if error_msg and len(all_buses) == 0:
        return ApiResponse(
            status="error",
            source="prim_live",
            message=error_msg,
            count=0,
            lines=[l["shortname"] for l in active_lines_info],
            buses=[],
            server_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

    if len(all_buses) == 0:
        return ApiResponse(
            status="no_data",
            source="prim_live",
            message=f"API PRIM connectée : aucun véhicule actuellement en circulation sur {', '.join(l['shortname'] for l in active_lines_info)}.",
            count=0,
            lines=[l["shortname"] for l in active_lines_info],
            buses=[],
            server_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

    return ApiResponse(
        status="ok",
        source="prim_live",
        message=f"{len(all_buses)} véhicules en circulation en direct sur {', '.join(l['shortname'] for l in active_lines_info)}.",
        count=len(all_buses),
        lines=[l["shortname"] for l in active_lines_info],
        buses=all_buses,
        server_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )

@app.get("/api/stops/{stop_name}/arrivals", response_model=StopArrivalsResponse)
async def get_stop_arrivals(
    stop_name: str,
    lat: float = Query(..., description="Latitude de l'arrêt"),
    lng: float = Query(..., description="Longitude de l'arrêt"),
    commune: Optional[str] = Query(default=None),
    stop_id: Optional[str] = Query(default=None),
    lines: Optional[str] = Query(default="128"),
):
    """
    RÉCUPÈRE LES PROCHAINS PASSAGES EN DIRECT DEPUIS L'API STOP-MONITORING PRIM.
    """
    api_key = get_api_key()
    arrivals: List[NextArrival] = []
    headers = {"apikey": api_key, "Accept": "application/json"}

    if api_key and stop_id and "stop-" not in stop_id:
        try:
            clean_id = stop_id.replace("IDFM:", "").replace("STIF:StopPoint:Q:", "").replace(":", "")
            stop_ref = f"STIF:StopPoint:Q:{clean_id}:"
            params = {"MonitoringRef": stop_ref}

            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.get(PRIM_STOP_MONITORING_URL, headers=headers, params=params)
                if r.status_code == 200:
                    data = r.json()
                    delivery = data.get("Siri", {}).get("ServiceDelivery", {}).get("StopMonitoringDelivery", [])
                    if delivery:
                        visits = delivery[0].get("MonitoredStopVisit", [])
                        now_utc = datetime.now(timezone.utc)

                        for v in visits:
                            j = v.get("MonitoredVehicleJourney", {})
                            call = j.get("MonitoredCall", {})
                            exp_time_str = call.get("ExpectedArrivalTime") or call.get("ExpectedDepartureTime")

                            if exp_time_str:
                                exp_dt = datetime.fromisoformat(exp_time_str.replace("Z", "+00:00"))
                                diff_min = max(0, int((exp_dt - now_utc).total_seconds() / 60))
                                line_code = extract_text(j.get("PublishedLineName"), "Ligne")
                                dest = extract_text(j.get("DestinationName"), "Direction")

                                info = await resolve_line_info(line_code, client)
                                line_color = info["color"] if info else "#009E94"

                                arrivals.append(
                                    NextArrival(
                                        line=line_code,
                                        line_color=line_color,
                                        destination=dest,
                                        eta_minutes=diff_min,
                                        expected_time=exp_time_str,
                                        distance_meters=None,
                                        vehicle_id=extract_text(j.get("VehicleRef")),
                                        status="prim_live",
                                    )
                                )
        except Exception as e:
            logger.debug(f"Stop-monitoring: {e}")

    # Complément avec les bus/métros réels en approche
    if len(arrivals) == 0:
        buses_resp = await get_buses(lines=lines)
        for bus in buses_resp.buses:
            dist = haversine(bus.latitude, bus.longitude, lat, lng)
            if dist < 7000:
                speed_mps = 8.0 if bus.mode in ("metro", "rail") else 5.5
                eta_min = max(1, int(round((dist / speed_mps) / 60)))
                arrivals.append(
                    NextArrival(
                        line=bus.line,
                        line_color=bus.line_color,
                        destination=bus.destination,
                        eta_minutes=eta_min,
                        distance_meters=int(round(dist)),
                        vehicle_id=bus.id,
                        status="real_bus_proximity",
                    )
                )

    arrivals.sort(key=lambda x: x.eta_minutes)

    return StopArrivalsResponse(
        stop_name=stop_name,
        commune=commune,
        stop_lat=lat,
        stop_lng=lng,
        arrivals=arrivals,
        tracked_lines=[x.strip() for x in (lines or "128").split(",") if x.strip()],
        source="prim_live",
        message=f"{len(arrivals)} passages réels détectés." if arrivals else "Aucun véhicule en approche immédiate.",
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )
