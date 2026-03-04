# Miklat | מקלט

A walking route planner for Tel Aviv-Yafo that keeps you within reach of a public bomb shelter at all times.

---

## Architecture

Zero-build single-page app. No framework, no bundler, no database.

```
miklat-vercel/
├── api/
│   └── config.js       Serverless function — returns Google Maps API key from env
├── public/
│   └── index.html      Entire app: HTML + CSS + vanilla JS (~1,100 lines)
├── vercel.json         Rewrites: /api/* → serverless, everything else → index.html
└── .gitignore
```

Hosted on **Vercel**. The serverless function exists solely to keep the Google API key out of the frontend source — the browser fetches it from `/api/config` at runtime (cached 1 hour via `s-maxage=3600`).

---

## Data sources

| Source | What it provides | Auth |
|--------|-----------------|------|
| **Tel Aviv-Yafo Municipality GIS** — [ArcGIS REST, layer 592](https://gisn.tel-aviv.gov.il/arcgis/rest/services/WM/IView2WM/MapServer/592) | Shelter locations with type, status, accessibility, filtration, area, entrance notes | None — open public data |
| **Google Maps JavaScript API** | Map rendering, geocoding, autocomplete, geometry calculations | API key |
| **Google Directions API** | Walking route polylines and waypoint routing | Same key |
| **Google Places API** | Address autocomplete on the input fields | Same key |

Shelter metadata returned from the municipal GIS includes: shelter type (`t_sug`), street address in Hebrew and English, operational status (`pail`), wheelchair accessibility (`miklat_mungash`), filtration system type (`t_sinon`), area in m² (`shetach_mr`), opening hours, entrance directions in Hebrew (`hearot`), and open/closed status.

---

## Route algorithm

A four-stage pipeline runs on every request. All processing happens client-side in the browser.

### 1. Direct route

Google Directions API returns a standard walking route between the two addresses. The encoded polyline is decoded into a sequence of lat/lng points.

### 2. Shelter fetch

A bounding box is computed around the direct route with a ~1.2 km buffer. A spatial query (envelope geometry, WGS84) is sent to the municipality's ArcGIS endpoint. All shelters intersecting the corridor are returned.

### 3. Shelter-aware re-routing

Every point on the direct polyline is checked for coverage — whether any shelter lies within the user's chosen radius (200 m, 400 m, or 600 m). Uncovered points are collected as gaps. For each gap point, the nearest shelter is found by geodesic distance. Unique nearest shelters become candidate waypoints, excluding any further than 4x the radius. The list is capped at 23 (Google's limit is 25 total; 2 are reserved for origin/destination).

The Directions API is called again with these shelters injected as `stopover: false` waypoints, bending the route toward shelter coverage without creating mandatory stops. If the waypoint request fails, the app falls back to the direct route.

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
| Shelter markers | Blue pins (larger if used as a route waypoint) |
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
3. Add environment variable: `GOOGLE_MAPS_API_KEY`
4. Enable in Google Cloud Console: Maps JavaScript API, Directions API, Places API

### Local development

Requires the Vercel CLI — a generic static server won't work because `/api/config` needs the serverless runtime.

```bash
npm i -g vercel
```

Create `.env.local` in the project root:

```
GOOGLE_MAPS_API_KEY=AIza...
```

```bash
vercel dev
```

---

## Limitations

- **Tel Aviv-Yafo only.** Shelter data comes exclusively from the Tel Aviv municipality GIS. Any portion of a route outside the city boundary has zero shelter coverage data.
- **Public shelters only.** Private mamad rooms (ממ״ד) in residential buildings are not in the municipal dataset.
- **Straight-line distance, not walking distance.** Coverage radius is measured as geodesic distance. A shelter 400 m away as the crow flies may be further on foot due to street layout and obstacles.
- **23-waypoint cap.** Google Directions limits requests to 25 waypoints (2 reserved for origin/destination). Very long routes with many gaps may not have all gaps addressed in a single routing call.
- **Longer routes.** The shelter-aware route can be noticeably longer than the direct route, depending on shelter density in the area.
- **No real-time status.** The `pail` (operational status) field reflects the municipality's records, not live conditions. Shelters may be temporarily closed for maintenance or locked outside emergencies.
- **No offline support.** Requires an internet connection and active Google API access.
- **Desktop-oriented.** The layout assumes a wide viewport with a fixed 340px sidebar. No explicit mobile breakpoints.
- **Not for emergency use.** This is a planning and awareness tool. Always verify shelter locations with the municipality or [Pikud HaOref](https://www.oref.org.il/).
