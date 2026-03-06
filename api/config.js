export default function handler(req, res) {
  // No API key needed — map uses OpenStreetMap tiles via Leaflet (free, no key required)
  // Routing uses OSRM public API, geocoding uses Nominatim
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({ provider: 'openstreetmap' });
}
