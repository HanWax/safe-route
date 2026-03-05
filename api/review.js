import sql from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shelter_id, rating, text } = req.body || {};

  if (!shelter_id || !/^[a-z]{2,6}-\d+$/.test(shelter_id))
    return res.status(400).json({ error: 'Invalid shelter_id' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be 1-5' });

  const reviewText = typeof text === 'string' ? text.slice(0, 500) : '';

  try {
    await sql`
      INSERT INTO shelter_reviews (shelter_id, rating, review_text)
      VALUES (${shelter_id}, ${rating}, ${reviewText})
    `;
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error('review error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
}
