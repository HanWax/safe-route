import sql from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { south, north, west, east } = req.query;
  const s = parseFloat(south), n = parseFloat(north), w = parseFloat(west), e = parseFloat(east);

  if ([s, n, w, e].some(isNaN))
    return res.status(400).json({ error: 'Bounding box params required: south, north, west, east' });

  try {
    const rows = await sql`
      SELECT id, lat, lng, name, description, created_at
      FROM community_shelters
      WHERE lat BETWEEN ${s} AND ${n}
        AND lng BETWEEN ${w} AND ${e}
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
