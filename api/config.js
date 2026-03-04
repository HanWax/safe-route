export default function handler(req, res) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not set in environment variables' });
  }
  // Only allow GET, cache for 1 hour
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({ key });
}
