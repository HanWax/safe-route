// Server-side proxy for GIS endpoints that require custom headers (e.g. Jerusalem)
export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  // Only allow proxying to known GIS domains
  const allowed = ['gisviewer.jerusalem.muni.il', 'opendatagis.br7.org.il'];
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid url' }); }
  if (!allowed.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const fetchOpts = {};
    if (parsed.hostname === 'gisviewer.jerusalem.muni.il') {
      fetchOpts.headers = { 'Referer': 'https://jergisng.jerusalem.muni.il/' };
    }
    const resp = await fetch(url, fetchOpts);
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }
    const data = await resp.json();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json(data);
  } catch (e) {
    console.error('Proxy fetch error:', e);
    res.status(502).json({ error: 'Proxy fetch failed', message: e.message });
  }
}
