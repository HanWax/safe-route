export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate');

  try {
    const resp = await fetch('https://api-m.ramat-gan.muni.il/api/MyNeighborhood/object/he?c=57254');
    if (!resp.ok) throw new Error('Upstream returned ' + resp.status);
    const data = await resp.json();

    const features = (data.locations || [])
      .filter(loc => loc.geometricObject && loc.geometricObject.x && loc.geometricObject.y)
      .map((loc, i) => ({
        attributes: {
          OBJECTID: i + 1,
          name: loc.name || '',
          address: loc.address || '',
          neighborhood: loc.neighborhood || '',
          dynamicField: loc.dynamicField || '',
        },
        geometry: {
          x: loc.geometricObject.x,
          y: loc.geometricObject.y,
        },
      }));

    res.status(200).json({ features });
  } catch (e) {
    console.error('Ramat Gan shelter fetch failed:', e);
    res.status(502).json({ error: 'Failed to fetch shelter data' });
  }
}
