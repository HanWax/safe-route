import sql from './_db.js';

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

async function checkRateLimit(ip) {
  const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const rows = await sql`
    SELECT COUNT(*) AS cnt FROM community_shelters
    WHERE ip_address = ${ip}
      AND created_at > ${cutoff}::timestamptz
  `;
  return parseInt(rows[0].cnt, 10) < RATE_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (forwarded ? forwarded.split(',')[0].trim() : null) || req.socket?.remoteAddress || 'unknown';

  try {
    if (!(await checkRateLimit(ip)))
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  } catch (e) {
    console.error('rate limit check error:', e);
  }

  const { lat, lng, name, description } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number' || lat < 29 || lat > 34 || lng < 34 || lng > 36)
    return res.status(400).json({ error: 'Invalid coordinates (must be within Israel)' });

  const shelterName = typeof name === 'string' ? name.slice(0, 200).trim() : '';
  const shelterDesc = typeof description === 'string' ? description.slice(0, 500).trim() : '';

  if (!shelterName)
    return res.status(400).json({ error: 'Name is required' });

  try {
    const rows = await sql`
      INSERT INTO community_shelters (lat, lng, name, description, ip_address)
      VALUES (${lat}, ${lng}, ${shelterName}, ${shelterDesc}, ${ip})
      RETURNING id, lat, lng, name, description, created_at
    `;
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error('community shelter error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
}
