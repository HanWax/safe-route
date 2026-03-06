const playwright = require('playwright-core');

const LAMBDA_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-gpu-sandbox',
  '--disable-software-rasterizer',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu-compositing',
];

async function getBrowser() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = require('@sparticuz/chromium');
    chromium.setHeadlessMode = true;
    chromium.setGraphicsMode = false;
    return playwright.chromium.launch({
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, ...LAMBDA_ARGS],
      headless: true,
    });
  }

  const fs = require('fs');
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  let executablePath;
  for (const p of candidates) {
    if (fs.existsSync(p)) { executablePath = p; break; }
  }
  if (!executablePath) {
    throw new Error('No local Chromium found. Install Chrome or run: npx playwright install chromium');
  }
  return playwright.chromium.launch({ executablePath, headless: true });
}

module.exports = async function handler(req, res) {
  const { olat, olng, dlat, dlng, r } = req.query;
  if (!olat || !olng || !dlat || !dlng) {
    return res.status(400).json({ error: 'Missing route coordinates' });
  }
  const coords = [parseFloat(olat), parseFloat(olng), parseFloat(dlat), parseFloat(dlng)];
  if (coords.some(isNaN) || Math.abs(coords[0]) > 90 || Math.abs(coords[2]) > 90 || Math.abs(coords[1]) > 180 || Math.abs(coords[3]) > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 1000 });

    // Use the production domain directly instead of VERCEL_URL
    // (VERCEL_URL can point to preview deployments)
    const baseUrl = process.env.VERCEL
      ? 'https://safe-route-lake.vercel.app'
      : 'http://localhost:' + (process.env.PORT || 3000);
    const params = new URLSearchParams({ olat, olng, dlat, dlng, r: r || '200' });
    const url = baseUrl + '/?' + params.toString();

    await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
    await page.waitForSelector('#shareRow', { state: 'visible', timeout: 40000 });
    await page.waitForTimeout(2000);

    // Hide sidebar so map fills viewport, thicken route lines, clean up UI
    await page.evaluate(() => {
      document.querySelectorAll('.sidebar, header').forEach(el => { el.style.display = 'none'; });
      var wrap = document.querySelector('.map-wrap');
      if (wrap) wrap.style.flex = 'none';
      var mapEl = document.getElementById('map');
      if (mapEl) { mapEl.style.width = '100vw'; mapEl.style.height = '100vh'; }
      if (window.App && App.map) {
        App.map.invalidateSize();
        App.map.zoomIn(1);
      }
      document.querySelectorAll('.leaflet-overlay-pane path').forEach(p => {
        p.style.strokeWidth = '7px';
      });
      document.querySelectorAll(
        '.leaflet-control-zoom, .leaflet-control-attribution, .legend, .drag-hint, #shareRow, #scoreWrap, #shelterSection, .status-bar, #dataSrc, .first-run-tip'
      ).forEach(el => { el.style.display = 'none'; });
    });

    // Wait for tiles to load at new zoom + size
    await page.waitForTimeout(3000);

    // Screenshot the map at high DPI
    const mapEl = await page.$('#map');
    const mapScreenshot = await mapEl.screenshot({ type: 'png' });
    const mapBase64 = mapScreenshot.toString('base64');

    // Extract route summary
    const routeData = await page.evaluate(() => {
      var s = window.App && App.lastRouteShare;
      if (!s) return null;
      return {
        distance: (s.totalDistance / 1000).toFixed(1),
        duration: Math.round(s.totalDuration / 60),
        coverage: Math.round(s.coveragePct),
      };
    });

    const rd = routeData || { distance: '?', duration: '?', coverage: '?' };

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=Noto+Sans+Hebrew:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Mono', monospace; color: #0f0f0f; }
  .page { display: flex; flex-direction: column; height: 190mm; }
  .bar { display: flex; justify-content: space-between; align-items: baseline; padding: 0 0 4px; flex-shrink: 0; }
  .title { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 800; }
  .meta { font-size: 9px; color: #555; }
  .map-wrap { flex: 1; min-height: 0; overflow: hidden; border: 1px solid #ddd; }
  .map { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
  .footer { flex-shrink: 0; padding-top: 3px; font-size: 7px; color: #aaa; }
</style></head><body>
  <div class="page">
    <div class="bar">
      <div class="title">Miklat Route</div>
      <div class="meta">${rd.distance} km &middot; ${rd.duration} min &middot; ${rd.coverage}% shelter coverage</div>
    </div>
    <div class="map-wrap"><img class="map" src="data:image/png;base64,${mapBase64}"></div>
    <div class="footer">Generated by Miklat Route &middot; miklat.vercel.app</div>
  </div>
</body></html>`;

    const pdfPage = await browser.newPage();
    await pdfPage.setContent(html, { waitUntil: 'networkidle' });

    const pdf = await pdfPage.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="miklat-route.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: err.message });
  } finally {
    if (browser) await browser.close();
  }
};
