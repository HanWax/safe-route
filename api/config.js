export default function handler(req, res) {
  // No longer needed — Google Maps replaced with Leaflet/OSM stack
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({});
}
