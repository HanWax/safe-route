import sql from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { shelters } = req.query;
  if (!shelters) return res.status(400).json({ error: 'shelters param required' });

  const ids = shelters.split(',').filter(id => /^tlv-\d+$/.test(id));
  if (!ids.length) return res.status(400).json({ error: 'No valid shelter IDs' });

  try {
    const rows = await sql`
      WITH agg AS (
        SELECT shelter_id,
               ROUND(AVG(rating)::numeric, 1) AS avg,
               COUNT(*)::int AS count
        FROM shelter_reviews
        WHERE shelter_id = ANY(${ids})
        GROUP BY shelter_id
      ),
      recent AS (
        SELECT shelter_id, rating, review_text, created_at,
               ROW_NUMBER() OVER (PARTITION BY shelter_id ORDER BY created_at DESC) AS rn
        FROM shelter_reviews
        WHERE shelter_id = ANY(${ids})
      )
      SELECT a.shelter_id, a.avg, a.count,
             COALESCE(json_agg(
               json_build_object('rating', r.rating, 'text', r.review_text, 'date', r.created_at)
               ORDER BY r.created_at DESC
             ) FILTER (WHERE r.shelter_id IS NOT NULL), '[]') AS reviews
      FROM agg a
      LEFT JOIN recent r ON r.shelter_id = a.shelter_id AND r.rn <= 10
      GROUP BY a.shelter_id, a.avg, a.count
    `;

    const result = {};
    for (const row of rows) {
      result[row.shelter_id] = {
        avg: parseFloat(row.avg),
        count: row.count,
        reviews: row.reviews,
      };
    }

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json(result);
  } catch (e) {
    console.error('reviews error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
}
