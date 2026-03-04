# מקלט | Miklat Route Planner

A walking route planner for Israel that keeps you within 5 minutes of a bomb shelter (מקלט) at all times.

## Deploy to Vercel

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
gh repo create miklat-route --public --push
```

### 2. Import to Vercel
- Go to [vercel.com/new](https://vercel.com/new)
- Import your GitHub repo
- No build settings needed (static + serverless)

### 3. Set environment variable
In Vercel project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `GOOGLE_MAPS_API_KEY` | `AIza...your key...` |

### 4. Enable these Google APIs
In [Google Cloud Console](https://console.cloud.google.com):
- Maps JavaScript API
- Directions API
- Places API

### 5. Restrict your API key
In Google Cloud → Credentials → your key → HTTP referrers:
```
https://your-project.vercel.app/*
https://your-custom-domain.com/*
```

## Local development
```bash
npm i -g vercel
vercel dev
```
Then set `GOOGLE_MAPS_API_KEY` in a `.env.local` file:
```
GOOGLE_MAPS_API_KEY=AIza...
```

## Data sources
- **OpenStreetMap** (Overpass API) — free, no key needed
- **Google Places API** — supplementary shelter data
