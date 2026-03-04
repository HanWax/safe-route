# מקלט | Miklat Route Planner

A walking route planner for Israel that keeps you within reach of a public bomb shelter (מקלט / miklat) at all times. Enter a start and end point, and the app finds the safest walking path — one that maximises your coverage by shelter radius rather than simply minimising distance.

---

## How it works

The app runs a four-stage pipeline every time you request a route.

### Stage 1 — Get the direct route

The Google Directions API is called for a standard walking route between the two addresses. This gives us the baseline path as a dense polyline (a sequence of lat/lng points decoded from Google's encoded polyline format). All subsequent stages use this polyline as their reference.

### Stage 2 — Fetch all shelters in the corridor

Two data sources are queried in parallel and deduplicated into a single shelter list:

**OpenStreetMap via Overpass API**

An Overpass QL query is sent to `overpass-api.de` covering a bounding box around the direct route with a ~1.2km buffer on all sides. The query searches for:

- `amenity=shelter` nodes and ways
- `shelter_type=public` nodes
- `building=bunker` nodes
- Any node or way whose name matches `מקלט` or `miklat` (case-insensitive)

Results include both point nodes and polygon ways (for the latter, the centroid is used). Hebrew name tags (`name:he`) are preferred over generic `name` tags where available.

**Google Places API (Nearby Search)**

Two keyword searches are run against the Places API centred on the route's midpoint: one for `מקלט` (Hebrew) and one for `bomb shelter miklat` (English). The search radius is set to half the bounding box diagonal, capped at 3,000m to avoid irrelevant results far from the route.

Both sources are merged into a single deduplicated list keyed by a unique ID (`osm-{id}` for OSM nodes/ways, `place_id` for Google results).

### Stage 3 — Build a shelter-aware route

This is the core of the algorithm. Rather than finding shelters *near* a given route, the goal here is to find a route that stays *near* shelters.

**Coverage check:** Every point on the direct-route polyline is tested against the shelter list. A point is considered "covered" if any shelter lies within the user's chosen radius (200m, 400m, or 600m — corresponding to roughly 2, 5, or 7 minutes at walking pace).

**Gap detection:** Points that fail the coverage check are collected as a gap set. If the entire direct route is already covered, no further routing is needed and we stop here.

**Waypoint selection:** For each uncovered point, the nearest shelter is found by iterating over all fetched shelters and computing the geodesic distance (using the Google Maps Geometry library's `computeDistanceBetween`). Each unique nearest shelter is added as a candidate waypoint. Shelters further than 4× the radius away are excluded (they're too far off-route to help). The list is capped at 23 waypoints to respect Google's Directions API limit of 25 waypoints per request (2 slots are reserved for origin and destination).

**Re-routing:** The Directions API is called again with these shelter locations injected as `stopover: false` waypoints. This tells Google to pass through the vicinity of each shelter without treating them as mandatory stops, producing a route that bends toward areas with shelter coverage. If the waypoint route request fails for any reason, the app gracefully falls back to the direct route.

### Stage 4 — Analyse and visualise coverage

The final route polyline (either the shelter-aware route or the direct route) is analysed point by point using the same coverage check from Stage 3. Points are tagged as covered or uncovered and then grouped into contiguous runs using a run-length encoding approach. Adjacent covered points form a "safe segment"; adjacent uncovered points form a "gap segment". Segment boundaries overlap by one point to ensure visual continuity on the map.

For each segment, the total distance is computed by summing geodesic distances between consecutive points. Coverage percentage is `coveredDistance / totalDistance × 100`, rounded to the nearest integer.

**The map displays:**

- **Black polyline** — segments within shelter radius (safe)
- **Red dashed polyline** — gap segments (no shelter within radius)
- **Green translucent circles** — the coverage radius around each miklat
- **Blue markers** — shelter locations (larger markers = used as a route waypoint)
- **Green dot** — start point
- **Red dot** — end point

The sidebar shows the overall coverage score (0–100%), total route distance and walk time, a count of miklatim found, and a clickable list of individual gap segments with their length in metres.

---

## Data sources

| Source | What it provides | API key required |
|--------|-----------------|-----------------|
| [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass API](https://overpass-api.de/) | Primary shelter locations, queried live | No — free and open |
| [Google Places API](https://developers.google.com/maps/documentation/places/web-service) | Supplementary shelter locations | Yes — Google Maps API key |
| [Google Directions API](https://developers.google.com/maps/documentation/directions) | Walking route generation and waypoint routing | Yes — same key |
| [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript) | Map rendering, geocoding, autocomplete, geometry calculations | Yes — same key |

### Notes on data completeness

OSM shelter coverage in Israel is uneven. Well-mapped cities like Tel Aviv and Jerusalem have good miklat data; smaller towns and newer neighbourhoods may have gaps. The Google Places layer helps fill some of these gaps, but it too is incomplete — it surfaces shelters that have been added as Google Maps POIs, which is a community-driven process.

**This app should not be relied upon for actual emergency preparedness.** It is a planning and awareness tool. Always verify shelter locations with your local municipality or the [IDF Home Front Command (פיקוד העורף)](https://www.oref.org.il/).

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
gh repo create miklat-route --public --push
```

### 2. Import to Vercel

Go to [vercel.com/new](https://vercel.com/new) and import your GitHub repo. No build settings are needed — the project is a static HTML file served from `/public` with a single serverless function in `/api`.

### 3. Set the environment variable

In your Vercel project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `GOOGLE_MAPS_API_KEY` | `AIza...your key...` |

### 4. Enable the required Google APIs

In [Google Cloud Console](https://console.cloud.google.com), enable all three on the same key:

- Maps JavaScript API
- Directions API
- Places API

### 5. Restrict your API key (recommended)

In Google Cloud → Credentials → your key → Application restrictions → HTTP referrers:

```
https://your-project.vercel.app/*
https://your-custom-domain.com/*
```

---

## Local development

Install the Vercel CLI and run the dev server, which emulates both the static file serving and the serverless `/api/config` function locally:

```bash
npm i -g vercel
vercel dev
```

Create a `.env.local` file in the project root with your key:

```
GOOGLE_MAPS_API_KEY=AIza...
```

The app will be available at `http://localhost:3000`.

---

## Project structure

```
miklat-vercel/
├── api/
│   └── config.js       — Serverless function: returns API key from env vars
├── public/
│   └── index.html      — Single-page app (HTML + CSS + JS, no build step)
├── vercel.json         — Routing: /api/* → serverless, everything else → index.html
├── .gitignore
└── README.md
```

The API key is never exposed in the frontend source code. The browser fetches it from `/api/config` at runtime, which reads from the Vercel environment variable server-side.

---

## Known limitations

- Google Directions API allows a maximum of 23 intermediate waypoints per request. For very long routes with many coverage gaps, the algorithm may not be able to close all gaps in a single routing call.
- The shelter-aware route may be noticeably longer than the direct route, depending on shelter density in the area.
- OSM and Google Places data can be outdated or incomplete. Newly built miklatim may not appear; decommissioned ones may still show.
- The coverage radius uses straight-line (geodesic) distance to shelters, not actual walking distance. A shelter 400m away as the crow flies may be further on foot if there are obstacles.
