# 🚌 Suivi Temps Réel - Bus RATP Ligne 128 (Fontenay-aux-Roses)

Prototype applicatif Full-Stack permettant de suivre en temps réel la position des bus RATP de la **ligne 128** sur une carte interactive Leaflet / OpenStreetMap, centrée sur **Fontenay-aux-Roses** (48.789, 2.288).

---

## 🏗️ Architecture Technique

```
bus_ratp/
├── backend/                  # Proxy API Python (FastAPI)
│   ├── main.py               # Serveur FastAPI, client PRIM, parsing SIRI Lite & simulation
│   ├── requirements.txt      # Dépendances Python (fastapi, uvicorn, httpx, etc.)
│   ├── .env.example          # Gabarit de configuration
│   └── .env                  # Configuration locale (clé API, LineRef, port)
│
├── frontend/                 # Application cartographique React
│   ├── src/
│   │   ├── components/
│   │   │   ├── MapView.jsx            # Carte Leaflet centrée sur Fontenay-aux-Roses
│   │   │   ├── AnimatedBusMarker.jsx  # Marqueur SVG personnalisé avec interpolation fluide
│   │   │   ├── Header.jsx             # En-tête, filtres, compteur et statut en direct
│   │   │   └── BusListSidebar.jsx     # Volet latéral des bus actifs avec focus carte
│   │   ├── App.jsx           # Polling 10s, gestion d'état et résilience réseau
│   │   ├── App.css           # Thème visuel RATP / IDFM
│   │   └── main.jsx
│   ├── vite.config.js        # Configuration Vite avec reverse-proxy /api
│   └── package.json
└── README.md
```

---

## ⚡ Démarrage Rapide

### 1. Démarrer le Backend (Proxy Python)

Dans un premier terminal :

```bash
cd backend

# Création et activation de l'environnement virtuel (recommandé)
python3 -m venv venv
source venv/bin/activate

# Installation des dépendances
pip install -r requirements.txt

# Lancement du serveur proxy
uvicorn main:app --reload --port 8000
```

Le proxy est accessible sur `http://localhost:8000`.  
Documentation Swagger interactive : `http://localhost:8000/docs`.

> 💡 **Mode Démo Immédiat :** Si vous n'avez pas encore renseigné de clé API PRIM, le backend démarre automatiquement en **mode simulation réaliste** : 4 bus se déplacent en temps réel le long de l'itinéraire officiel du 128 à Fontenay-aux-Roses. Vous pouvez tester l'animation et l'interface immédiatement !

---

### 2. Démarrer le Frontend (React + Leaflet)

Dans un second terminal :

```bash
cd frontend

# Installation des dépendances npm
npm install

# Lancement de l'application React
npm run dev
```

Ouvrez ensuite votre navigateur sur **`http://localhost:5173`**.

---

## 🔑 Configuration de l'API PRIM (Île-de-France Mobilités)

Pour connecter l'application au flux en direct officiel :

1. **Créer un compte PRIM :**  
   Rendez-vous sur [prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr/) et créez un compte développeur gratuit.
2. **Générer un jeton API :**  
   Dans votre profil > **Mes jetons d'authentification** > générez une clé API.
3. **Configurer votre clé dans le projet :**  
   Éditez le fichier `backend/.env` :
   ```ini
   IDFM_API_KEY=votre_cle_api_secrete_ici
   ```
   *(Vous pouvez aussi renseigner directement la constante `DEFAULT_IDFM_API_KEY` dans `backend/main.py`).*

---

## 📍 Identifiant Technique de la Ligne 128 (`LineRef`)

Dans le référentiel officiel d'Île-de-France Mobilités (norme SIRI Lite) :
- **Ligne :** Bus 128 (Porte d'Orléans &harr; Robinson RER)
- **Code Référentiel IDFM :** `C01157`
- **Syntaxe SIRI Lite standard :** `STIF:Line::C01157:`

Cet identifiant est configuré dans `backend/.env` :
```ini
IDFM_LINE_REF=STIF:Line::C01157:
```

> Si vous souhaitez suivre une autre ligne (ex: Bus 394, Bus 194, etc.), modifiez simplement la valeur de `IDFM_LINE_REF` dans `backend/.env` ou passez le paramètre `?line_ref=...` dans la requête.

---

## 🌟 Fonctionnalités Incluses

- 🗺️ **Carte Leaflet OpenStreetMap** : Centrée sur Fontenay-aux-Roses (`[48.789, 2.288]`, zoom `15`).
- ⏱️ **Polling automatique toutes les 10 secondes** avec `setInterval`, décompte visuel en temps réel et bouton d'actualisation manuelle.
- 🎨 **Marqueur personnalisé SVG** : Bus aux couleurs RATP (Vert Jade) avec badge "128", orientation directionnelle (`bearing`) et anneau radar.
- 🌊 **Interpolation fluide du mouvement** : Utilisation de `requestAnimationFrame` avec courbe d'atténuation (easing cubique) sur 2 secondes pour faire glisser le bus en douceur entre deux rafraîchissements GPS.
- 💬 **Popup d'informations complet** : Destination, sens, vitesse, ponctualité, ID du véhicule et coordonnées GPS.
- 🛣️ **Tracé de la ligne 128** : Affichage toggleable de l'itinéraire et des arrêts (Division Leclerc, Mairie, Scarron, etc.).
- 🛡️ **Résilience aux pannes réseau** : Si l'API met du temps à répondre ou subit un timeout (8s), le frontend conserve l'état affiché sans planter et signale l'incident avec un bandeau élégant.

