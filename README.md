# מקלט | Miklat Route Planner

A walking route planner for Tel Aviv-Yafo that keeps you within reach of a public bomb shelter (מקלט / miklat) at all times. Enter a start and end point, and the app finds the safest walking path — one that maximises your coverage by shelter radius rather than simply minimising distance.

---

## How it works

The app runs a four-stage pipeline every time you request a route.

### Stage 1 — Get the direct route

The Google Directions API is called for a standard walking route between the two addresses. This gives us the baseline path as a dense polyline (a sequence of lat/lng points decoded from Google's encoded polyline format). All subsequent stages use this polyline as their reference.

### Stage 2 — Fetch all shelters in the corridor

A spatial query is sent to the **Tel Aviv-Yafo Municipality GIS** ([ArcGIS REST API, layer 592](https://gisn.tel-aviv.gov.il/arcgis/rest/services/WM/IView2WM/MapServer/592)) covering a bounding box around the direct route with a ~1.2 km buffer on all sides. The query uses an envelope geometry in WGS84 and returns all shelter features that intersect the corridor.

Each shelter record includes:

| Field | Hebrew alias | Description |
|-------|-------------|-------------|
| `t_sug` | תאור סוג | Shelter type — one of ~10 categories (see below) |
| `Full_Address` | כתובת | Street address in Hebrew |
| `shem_rechov_eng` | שם רחוב באנגלית | Street name in English |
| `pail` | כשירות | Operational status, e.g. "כשיר לשימוש" (fit for use) |
| `miklat_mungash` | נגישות | Wheelchair accessibility |
| `t_sinon` | תאור סינון | Filtration system type |
| `shetach_mr` | שטח מר | Area in square metres |
| `opening_times` | שעות פתיחה | Opening hours, e.g. "פתיחה אוטומטית בשעת חירום" |
| `hearot` | הערות | Hebrew entrance directions and notes |
| `is_open` | האם פתוח | Whether currently open |

**Shelter types (`t_sug`):**

- מקלט ציבורי — Public shelter
- מקלט ציבורי נגיש — Accessible public shelter
- חניון מחסה לציבור — Parking garage shelter
- מקלט בשטח חניון — Shelter in parking area
- מקלט פנימי בשטח בית ספר — School internal shelter
- מקלט ציבורי במוסדות חינוך — Public shelter in educational institutions
- מתקן מיגון גני ילדים — Kindergarten protection facility
- מתקן מיגון רווחה — Welfare protection facility
- מתקן מיגון קהילה — Community protection facility
- רכבת קלה מחסה לציבור — Light rail public shelter

No API key is required for the municipal GIS endpoint — it is open public data.

### Stage 3 — Build a shelter-aware route

This is the core of the algorithm. Rather than finding shelters *near* a given route, the goal is to find a route that stays *near* shelters.

**Coverage check:** Every point on the direct-route polyline is tested against the shelter list. A point is considered "covered" if any shelter lies within the user's chosen radius (200 m, 400 m, or 600 m — corresponding to roughly 2, 5, or 7 minutes at walking pace).

**Gap detection:** Points that fail the coverage check are collected as a gap set. If the entire direct route is already covered, no further routing is needed and we stop here.

**Waypoint selection:** For each uncovered point, the nearest shelter is found by computing the geodesic distance (using the Google Maps Geometry library's `computeDistanceBetween`). Each unique nearest shelter is added as a candidate waypoint. Shelters further than 4× the radius away are excluded. The list is capped at 23 waypoints to respect Google's Directions API limit of 25 waypoints per request (2 slots are reserved for origin and destination).

**Re-routing:** The Directions API is called again with these shelter locations injected as `stopover: false` waypoints. This tells Google to pass through the vicinity of each shelter without treating them as mandatory stops, producing a route that bends toward areas with shelter coverage. If the waypoint route request fails, the app gracefully falls back to the direct route.

### Stage 4 — Analyse and visualise coverage

The final route polyline is analysed point by point using the same coverage check from Stage 3. Points are tagged as covered or uncovered and grouped into contiguous runs using a run-length encoding approach. Adjacent covered points form a "safe segment"; adjacent uncovered points form a "gap segment". Segment boundaries overlap by one point to ensure visual continuity on the map.

For each segment, the total distance is computed by summing geodesic distances between consecutive points. Coverage percentage is `coveredDistance / totalDistance × 100`, rounded to the nearest integer.

**The map displays:**

- **Black polyline** — segments within shelter radius (safe)
- **Red dashed polyline** — gap segments (no shelter within radius)
- **Green translucent circles** — the coverage radius around each miklat
- **Blue markers** — shelter locations (larger markers = used as a route waypoint)
- **Green dot** — start point
- **Red dot** — end point

The sidebar shows the overall coverage score (0–100 %), total route distance and walk time, a count of miklatim found, and a clickable list of individual gap segments with their length in metres. Each shelter card displays the shelter type, accessibility badge, filtration system, area, operational status, and Hebrew entrance directions where available.

---

## Data sources

| Source | What it provides | API key required |
|--------|-----------------|-----------------|
| [Tel Aviv-Yafo Municipality GIS](https://gisn.tel-aviv.gov.il/) | Shelter locations with type, status, accessibility, filtration, area, and entrance notes (layer 592) | No — open public data |
| [Google Directions API](https://developers.google.com/maps/documentation/directions) | Walking route generation and waypoint routing | Yes — Google Maps API key |
| [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript) | Map rendering, geocoding, autocomplete, geometry calculations | Yes — same key |

### Why municipal GIS instead of OpenStreetMap?

The Tel Aviv municipality maintains an authoritative, regularly updated shelter database as part of its emergency preparedness infrastructure (parent layer: ביטחון ושעת חירום). Compared to OpenStreetMap or Google Places:

- **More complete** — includes all registered public shelters, not just community-mapped ones
- **Richer metadata** — operational status, filtration system, area, accessibility, entrance directions
- **Authoritative** — maintained by the municipality under Home Front Command oversight
- **No API key** — the ArcGIS REST endpoint is open, reducing external dependencies

The trade-off is that this version only covers Tel Aviv-Yafo. Routes that start or end outside the municipality boundary will have shelter data only for the Tel Aviv portion.

### Notes on data completeness

The municipal dataset covers public shelters registered with the city. Private mamad rooms (ממ״ד) in individual apartments are not included. Some shelters may be temporarily closed for maintenance. The `pail` (כשירות) field indicates operational status but may not reflect real-time conditions.

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

In [Google Cloud Console](https://console.cloud.google.com), enable these on the same key:

- Maps JavaScript API
- Directions API
- Places API (for autocomplete only)

### 5. Restrict your API key (recommended)

In Google Cloud → Credentials → your key → Application restrictions → HTTP referrers:

```
https://your-project.vercel.app/*
https://your-custom-domain.com/*
```

---

## Local development

You **must** use the Vercel CLI to run locally — opening `index.html` directly or using a generic static server will not work, because the `/api/config` serverless function needs the Vercel runtime to execute.

```bash
npm i -g vercel
vercel dev
```

Create a `.env.local` file in the project root (same directory as `vercel.json`) with your key:

```
GOOGLE_MAPS_API_KEY=AIza...
```

The app will be available at `http://localhost:3000`.

> **Troubleshooting:** If you see `SyntaxError: Unexpected token '<', "<!DOCTYPE"...` in the console, it means `/api/config` is returning the HTML page instead of JSON. Verify that (1) you are using `vercel dev`, not another dev server, and (2) `.env.local` exists in the project root with a valid key.

---

## Project structure

```
miklat-route/
├── api/
│   └── config.js       — Serverless function: returns API key from env vars
├── public/
│   └── index.html      — Single-page app (HTML + CSS + JS, no build step)
├── vercel.json         — Routing: non-API requests → index.html (API routes handled automatically)
├── .gitignore
└── README.md
```

The Google API key is never exposed in the frontend source code. The browser fetches it from `/api/config` at runtime, which reads from the Vercel environment variable server-side.

---

## Known limitations

- **Tel Aviv only** — shelter data comes from the Tel Aviv-Yafo municipality. Routes outside the city boundary will have no shelter coverage data.
- Google Directions API allows a maximum of 23 intermediate waypoints per request. For very long routes with many coverage gaps, the algorithm may not be able to close all gaps in a single routing call.
- The shelter-aware route may be noticeably longer than the direct route, depending on shelter density in the area.
- The coverage radius uses straight-line (geodesic) distance to shelters, not actual walking distance. A shelter 400 m away as the crow flies may be further on foot if there are obstacles.
- Municipal data may not reflect real-time conditions. Shelters can be temporarily closed for maintenance or locked outside emergency periods.
- Private mamad rooms (ממ״ד) in individual apartments are not included in the dataset.

---

## Extending to other cities

Other Israeli municipalities may expose similar GIS endpoints. The architecture is designed so that `fetchTLVShelters` can be replaced or supplemented with additional city-specific fetchers. Known potential sources:

- **Be'er Sheva** — publishes shelter data as GeoJSON via its [municipal open data portal](https://www.beer-sheva.muni.il/)
- **Pikud HaOref** — the Home Front Command app has shelter data but does not expose a public API for locations (only for real-time alerts)
- **Harmony SOS** — a community-built shelter locator with ~1,400 verified shelters across Israel, particularly strong in Arab communities

Contributions adding support for additional municipalities are welcome.
