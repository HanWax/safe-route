import sql from './_db.js';

// Simple in-memory rate limit: max 5 submissions per IP per 10 minutes
const rateLimitMap = new Map();
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });

  const { lat, lng, name, description } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number' || lat < 29 || lat > 34 || lng < 34 || lng > 36)
    return res.status(400).json({ error: 'Invalid coordinates (must be within Israel)' });

  const shelterName = typeof name === 'string' ? name.slice(0, 200).trim() : '';
  const shelterDesc = typeof description === 'string' ? description.slice(0, 500).trim() : '';

  if (!shelterName)
    return res.status(400).json({ error: 'Name is required' });

  try {
    const rows = await sql`
      INSERT INTO community_shelters (lat, lng, name, description)
      VALUES (${lat}, ${lng}, ${shelterName}, ${shelterDesc})
      RETURNING id, lat, lng, name, description, created_at
    `;
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error('community shelter error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
}
