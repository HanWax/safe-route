import sql from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { south, north, west, east } = req.query;
  const s = parseFloat(south), n = parseFloat(north), w = parseFloat(west), e = parseFloat(east);

  if ([s, n, w, e].some(isNaN))
    return res.status(400).json({ error: 'Bounding box params required: south, north, west, east' });

  // Clamp to Israel bounds to prevent full-table scans
  const cs = Math.max(s, 29), cn = Math.min(n, 34), cw = Math.max(w, 34), ce = Math.min(e, 36);
  if (cs >= cn || cw >= ce)
    return res.status(400).json({ error: 'Bounding box out of range' });

  try {
    const rows = await sql`
      SELECT id, lat, lng, name, description, created_at
      FROM community_shelters
      WHERE lat BETWEEN ${cs} AND ${cn}
        AND lng BETWEEN ${cw} AND ${ce}
      ORDER BY created_at DESC
      LIMIT 500
    `;
    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json(rows);
  } catch (err) {
    console.error('community shelters error:', err);
    return res.status(500).json({ error: 'DB error' });
  }
}
