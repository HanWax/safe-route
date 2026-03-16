# Miklat | מקלט

A walking route planner for Israel that keeps you within reach of a public bomb shelter at all times.

---

## Architecture

Zero-build single-page app. No framework, no bundler. Neon PostgreSQL for reviews and community shelters.

```
miklat-vercel/
├── api/
│   ├── _db.js              Neon DB connection
│   ├── review.js            Shelter reviews (POST)
│   ├── reviews.js           Shelter reviews (GET)
│   ├── community-shelter.js Community shelters (POST)
│   ├── community-shelters.js Community shelters (GET)
│   └── pdf.js               Server-side PDF export
├── public/
│   ├── index.html           Main HTML
│   ├── css/styles.css       Stylesheet
│   └── js/
│       ├── app.js           Main app logic
│       ├── map.js           Leaflet map, Photon autocomplete, markers
│       ├── route.js         Shelter fetch, Valhalla routing, coverage analysis
│       ├── config.js        City configs with ArcGIS endpoints
│       ├── ui.js            UI rendering (score, shelter list, gaps, reviews)
│       ├── community.js     Community miklat add/fetch
│       ├── i18n.js          EN/HE translations
│       └── mobile.js        Mobile bottom sheet
├── vercel.json              Rewrites + function config
└── .gitignore
```

Hosted on **Vercel**. Fully open-source map stack — no API keys required for map, routing, or geocoding.

---

## Data sources

| Source | What it provides | Auth |
|--------|-----------------|------|
| **Municipal GIS** — ArcGIS REST endpoints per city | Shelter locations with type, status, accessibility, filtration, area, entrance notes | None — open public data |
| **Leaflet** + CartoDB Positron tiles | Map rendering | None |
| **Valhalla** (OpenStreetMap) | Walking routes and distance matrix | None |
| **Nominatim** (OpenStreetMap) | Geocoding | None |
| **Photon** (Komoot) | Address autocomplete | None |
| **Neon PostgreSQL** | Shelter reviews and community shelters | Connection string |

---

## Route algorithm

A four-stage pipeline runs on every request. All processing happens client-side in the browser.

### 1. Direct route

Valhalla pedestrian routing returns a walking route between the two addresses. The encoded polyline is decoded into a sequence of lat/lng points.

### 2. Shelter fetch

A bounding box is computed around the direct route with a ~1.2 km buffer. A spatial query (envelope geometry, WGS84) is sent to the municipality's ArcGIS endpoint. All shelters intersecting the corridor are returned.

### 3. Shelter-aware re-routing

Every point on the direct polyline is checked for coverage — whether any shelter lies within walking distance of the user's chosen radius (200 m, 400 m, or 600 m), using a 1.3× correction factor to convert straight-line to walking distance. Uncovered points are collected as gaps. For each gap point, the nearest shelter is found by geodesic distance. Unique nearest shelters become candidate waypoints, excluding any further than 4x the effective radius.

Valhalla is called again with these shelters injected as intermediate locations, bending the route toward shelter coverage without creating mandatory stops. If the waypoint request fails, the app falls back to the direct route.

### 4. Coverage analysis

The final polyline is walked point by point. Points are tagged covered/uncovered and grouped into contiguous runs (run-length encoding). Adjacent covered points form safe segments; adjacent uncovered points form gap segments. Segment boundaries overlap by one point for visual continuity.

Coverage percentage = covered distance / total distance x 100.

---

## Map rendering

| Element | Appearance |
|---------|------------|
| Safe segments | Black solid polyline |
| Gap segments | Red dashed polyline |
| Shelter coverage | Green translucent circles at chosen radius |
| Shelter markers | Blue circle markers (official) / Orange dashed (community) |
| Start point | Green dot |
| End point | Red dot |

The sidebar displays: coverage score (0-100%), total distance and walk time, shelter count, clickable gap segments with length in metres, and a shelter list with type/accessibility/filtration/area/status tags.

---

## Fonts

- **DM Mono** — all UI text
- **Syne** — display/header
- **Noto Sans Hebrew** — Hebrew shelter data

---

## Setup

### Deploy to Vercel

1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new) — no build settings needed
3. Add environment variable: `DATABASE_URL` (Neon PostgreSQL connection string)

### Local development

Requires the Vercel CLI for serverless function support.

```bash
npm i -g vercel
```

Create `.env.local` in the project root:

```
DATABASE_URL=postgres://...
```

```bash
vercel dev
```

---

## Limitations

- **Public shelters only.** Private mamad rooms (ממ״ד) in residential buildings are not in the municipal dataset.
- **Walking distance is approximate for coverage checks.** Coverage radius applies a 1.3× correction factor to convert straight-line distance to estimated walking distance.
- **Longer routes.** The shelter-aware route can be noticeably longer than the direct route, depending on shelter density in the area.
- **No real-time status.** The `pail` (operational status) field reflects the municipality's records, not live conditions. Shelters may be temporarily closed for maintenance or locked outside emergencies.
- **Not for emergency use.** This is a planning and awareness tool. Always verify shelter locations with the municipality or [Pikud HaOref](https://www.oref.org.il/).
