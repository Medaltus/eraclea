/**
 * api/write-report-insights.js  (eraclea — brand id 'eraclea', tabs 'eraclea' / 'eraclea_events')
 * POST /api/write-report-insights
 *
 * Backend for the eraclea dashboard's editable report content (Executive
 * Summary, Amazon Key Insight, Ad Impressions Note, Insights > Category and
 * Subscriptions Key Insights, Opportunity and Accomplished cards, and the
 * per-event summaries on the Events page). Reads/writes SHEET_REPORT_INSIGHTS
 * (Report Insights workbook), one pair of tabs for eraclea:
 *   eraclea         — one row per month. Exec Summary, Key Insights,
 *                     6 Opportunity and 4 Accomplished card slots, plus status/approval.
 *   eraclea_events  — one row per (event_name, event_year). Per-event
 *                     summary title/body, plus its own status/approval.
 *
 * Ported 2026-10-29 from PB & Jay's write-report-insights.js. Behavior is
 * identical (upsert by year+month or event_name+event_year; any save resets
 * an Approved row to Draft; only action:'approve' sets Approved). eraclea
 * differences:
 *   - Self-contained brand: does not depend on config/brands.js having an
 *     'eraclea' entry. The dashboard posts brand:'eraclea'; anything else
 *     is rejected.
 *   - Tabs created by Jaclyn 2026-10-29: 'eraclea' (gid 1479705375) and
 *     'eraclea_events' (gid 810998273). Headers verified against the live
 *     sheet the same day — MONTHLY_HEADERS below is the 'eraclea' tab's
 *     exact A..BF order (58 columns, identical to PB & Jay's).
 *     replaceRows() writes POSITIONALLY, so this array must match the
 *     sheet column-for-column. New columns only ever get appended at the
 *     END of both the sheet and this array — never inserted.
 *   - Images exist for Accomplished cards 1 & 2 only (the eraclea
 *     dashboard only saves image fields for those two cards).
 *
 * POST body:
 *   Monthly: { brand:'eraclea', scope:'monthly', year, month, fields:{...}, action:'save'|'approve' }
 *   Event:   { brand:'eraclea', scope:'event', eventName, eventYear, fields:{...}, action:'save'|'approve' }
 *   fields is optional on action:'approve' (approving doesn't require new content).
 */

// SELF-CONTAINED (2026-10-29): the eraclea repo has no api/config/
// folder, so the PB & Jay version's require('./config/_sheets_client') and
// require('./config/sheets') crashed the function ("Cannot find module").
// This file now talks to the Sheets API directly with googleapis (already in
// package.json) and the same GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env vars
// as upload-insight-image.js. Nothing else to add to the repo.
const { google } = require('googleapis');

const BRAND_ID = 'eraclea';
const MONTHLY_TAB = 'eraclea';
const EVENTS_TAB = 'eraclea_events';
// Report Insights workbook (shared by every brand).
const REPORT_INSIGHTS = '1Fz0bEArdx54vTSGMGj-m6TYec1kizKyPubJOZNWBaLg';

const MONTHLY_HEADERS = [
  'year', 'month', 'exec_summary_title',
  'exec_summary_left', 'exec_summary_right', 'amazon_key_insight',
  'website_key_insight', 'walmart_key_insight', 'opp1_title',
  'opp1_subtitle', 'opp1_body', 'opp2_title',
  'opp2_subtitle', 'opp2_body', 'opp3_title',
  'opp3_subtitle', 'opp3_body', 'opp4_title',
  'opp4_subtitle', 'opp4_body', 'status',
  'approved_by', 'approved_at', 'last_updated',
  'last_updated_by', 'ad_impressions_note', 'category_key_insight',
  'accomplished1_title', 'accomplished1_subtitle', 'accomplished1_body',
  'accomplished1_image1', 'accomplished1_image2', 'accomplished1_image3',
  'accomplished2_title', 'accomplished2_subtitle', 'accomplished2_body',
  'accomplished2_image1', 'accomplished2_image2', 'accomplished3_title',
  'accomplished3_subtitle', 'accomplished3_body', 'accomplished4_title',
  'accomplished4_subtitle', 'accomplished4_body', 'opp5_title',
  'opp5_subtitle', 'opp5_body', 'opp6_title',
  'opp6_subtitle', 'opp6_body', 'accomplished1_image4',
  'accomplished1_image5', 'accomplished1_image6', 'accomplished2_image3',
  'accomplished2_image4', 'accomplished2_image5', 'accomplished2_image6',
  'subscriptions_key_insight', // column BF
];

// acc{n}_* (older dashboards) -> accomplished{n}_* (this sheet's real columns).
const FIELD_ALIASES = {};
[1, 2, 3, 4].forEach(n => {
  ['title', 'subtitle', 'body', 'image1', 'image2', 'image3', 'image4', 'image5', 'image6'].forEach(f => {
    FIELD_ALIASES[`acc${n}_${f}`] = `accomplished${n}_${f}`;
  });
});

const EVENT_HEADERS = [
  'event_name', 'event_year',
  'summary_title', 'summary_body',
  'status', 'approved_by', 'approved_at', 'last_updated', 'last_updated_by',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { brand: brandId, scope, year, month, eventName, eventYear, fields, action, actor } = req.body || {};

  if (brandId !== BRAND_ID) return res.status(400).json({ error: `Brand '${brandId}' is not handled by this endpoint (expected '${BRAND_ID}')` });

  if (scope !== 'monthly' && scope !== 'event') {
    return res.status(400).json({ error: "scope must be 'monthly' or 'event'" });
  }
  if (action !== 'save' && action !== 'approve') {
    return res.status(400).json({ error: "action must be 'save' or 'approve'" });
  }

  try {
    if (scope === 'monthly') {
      const yearStr = String(year ?? '').trim();
      const monthStr = String(month ?? '').trim();
      if (!yearStr || !monthStr) return res.status(400).json({ error: 'year and month are required for scope=monthly' });
      const monthNum = Number(monthStr);
      if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ error: `month must be an integer 1-12, got '${month}'` });
      }
      const result = await upsertRow({
        tabName: MONTHLY_TAB,
        headers: MONTHLY_HEADERS,
        matchFields: { year: yearStr, month: monthStr },
        fields, action, actor,
      });
      return res.status(200).json({ ok: true, row: result });
    } else {
      const eventNameStr = String(eventName ?? '').trim();
      const eventYearStr = String(eventYear ?? '').trim();
      if (!eventNameStr || !eventYearStr) return res.status(400).json({ error: 'eventName and eventYear are required for scope=event' });
      const result = await upsertRow({
        tabName: EVENTS_TAB,
        headers: EVENT_HEADERS,
        matchFields: { event_name: eventNameStr, event_year: eventYearStr },
        fields, action, actor,
      });
      return res.status(200).json({ ok: true, row: result });
    }
  } catch (err) {
    console.error('[write-report-insights][eraclea] failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function upsertRow({ tabName, headers, matchFields, fields, action, actor }) {
  const token = await ensureTab(REPORT_INSIGHTS, tabName, headers);
  const existing = await readRows(REPORT_INSIGHTS, tabName, token);

  const matchKeys = Object.keys(matchFields);
  const idx = existing.findIndex(r => matchKeys.every(k => String(r[k] || '') === matchFields[k]));

  let row;
  if (idx === -1) {
    row = {};
    headers.forEach(h => { row[h] = ''; });
    Object.assign(row, matchFields);
  } else {
    row = { ...existing[idx] }; // copy — don't mutate the object still sitting in `existing`
  }

  if (fields) {
    const dropped = [];
    Object.entries(fields).forEach(([k, v]) => {
      const key = headers.includes(k) ? k : (FIELD_ALIASES[k] && headers.includes(FIELD_ALIASES[k]) ? FIELD_ALIASES[k] : null);
      if (key) row[key] = v == null ? '' : String(v);
      else dropped.push(k);
    });
    if (dropped.length) console.warn(`[write-report-insights][eraclea] ${tabName}: ignored unknown field(s): ${dropped.join(', ')}`);
  }

  const nowIso = new Date().toISOString();
  if (action === 'approve') {
    row.status = 'Approved';
    row.approved_by = actor || '';
    row.approved_at = nowIso;
  } else {
    // Any content save reverts an already-approved row to Draft.
    row.status = row.status === 'Approved' ? 'Draft' : (row.status || 'Draft');
  }
  row.last_updated = nowIso;
  row.last_updated_by = actor || '';

  const updatedRows = idx === -1 ? [...existing, row] : existing.map((r, i) => (i === idx ? row : r));
  const rowArrays = updatedRows.map(r => headers.map(h => r[h] ?? ''));
  await replaceRows(REPORT_INSIGHTS, tabName, headers, rowArrays, token);
  return row;
}

// ── Sheets API helpers (replace the old config/_sheets_client) ──────────
function sheetsClient() {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Server is missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');
  }
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}
const q = tab => `'${String(tab).replace(/'/g, "''")}'`;

// Creates the tab with a header row if it doesn't exist. Returns the client
// (the "token" the old helper returned, passed back into replaceRows).
async function ensureTab(spreadsheetId, tabName, headers) {
  const api = sheetsClient();
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some(sh => sh.properties.title === tabName);
  if (!exists) {
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] } });
    await api.spreadsheets.values.update({
      spreadsheetId, range: `${q(tabName)}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
  return api;
}

// Rows as objects keyed by the sheet's OWN header row (row 1).
async function readRows(spreadsheetId, tabName, api) {
  api = api || sheetsClient();
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${q(tabName)}!A1:ZZ`, valueRenderOption: 'FORMATTED_VALUE' });
  const values = res.data.values || [];
  if (!values.length) return [];
  const hdr = values[0].map(h => String(h || '').trim());
  return values.slice(1).map(v => { const o = {}; hdr.forEach((h, i) => { if (h) o[h] = v[i] == null ? '' : String(v[i]); }); return o; });
}

// Rewrites every data row. Values are placed by matching HEADER NAME, not
// by position, so a column reorder in the sheet can never shift data into
// the wrong column. Any expected header missing from the sheet is appended
// to the END of row 1 (never inserted). Written RAW, so text is stored
// exactly as typed (no formula / number / date conversion).
async function replaceRows(spreadsheetId, tabName, headers, rowArrays, api) {
  api = api || sheetsClient();
  const hdrRes = await api.spreadsheets.values.get({ spreadsheetId, range: `${q(tabName)}!1:1` });
  const sheetHdr = ((hdrRes.data.values || [])[0] || []).map(h => String(h || '').trim());
  const missing = headers.filter(h => !sheetHdr.includes(h));
  const finalHdr = sheetHdr.concat(missing);
  if (missing.length) {
    await api.spreadsheets.values.update({ spreadsheetId, range: `${q(tabName)}!A1`, valueInputOption: 'RAW', requestBody: { values: [finalHdr] } });
  }
  const objs = rowArrays.map(arr => { const o = {}; headers.forEach((h, i) => { o[h] = arr[i] == null ? '' : String(arr[i]); }); return o; });
  const out = objs.map(o => finalHdr.map(h => (h && o[h] != null) ? o[h] : ''));
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${q(tabName)}!A2:ZZ` });
  if (out.length) {
    await api.spreadsheets.values.update({ spreadsheetId, range: `${q(tabName)}!A2`, valueInputOption: 'RAW', requestBody: { values: out } });
  }
}
