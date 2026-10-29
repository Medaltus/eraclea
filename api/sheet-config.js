// api/sheet-config.js — eraclea dashboard
//
// Serves the SHEET_CONFIG Vercel env var (one JSON blob of
// { KEY: { fileId, gid } }) to the dashboard. Public/index.html loads it
// with a synchronous XHR to /api/sheet-config at the very top of <head>
// and stores it as window.SHEET_CFG before any other script runs.
//
// The filename must be sheet-config.js (hyphen): the URL the page calls
// is /api/sheet-config. A file named sheet_config.js would be served at
// /api/sheet_config instead, the page would get a 404, and every section
// would load with no sheet IDs ("No eraclea data found…").
//
// Changing SHEET_CONFIG in Vercel only takes effect after a redeploy.

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const raw = process.env.SHEET_CONFIG;
  if (!raw || !raw.trim()) {
    console.error('[sheet-config] SHEET_CONFIG env var is missing or empty');
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'SHEET_CONFIG env var is missing or empty' }));
    return;
  }

  let cfg;
  try {
    cfg = JSON.parse(raw.trim());
    // Tolerate the value having been pasted as a quoted JSON string.
    if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  } catch (err) {
    console.error('[sheet-config] SHEET_CONFIG is not valid JSON:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'SHEET_CONFIG is not valid JSON', detail: err.message }));
    return;
  }

  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    console.error('[sheet-config] SHEET_CONFIG must be a JSON object of { KEY: { fileId, gid } }');
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'SHEET_CONFIG must be a JSON object' }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(cfg));
};
