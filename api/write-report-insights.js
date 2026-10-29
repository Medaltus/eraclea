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
 *   - Neither tab existed in the Report Insights workbook as of 2026-10-29,
 *     so ensureTab() creates both with the headers below on the first save.
 *   - MONTHLY_HEADERS = PB & Jay's exact A..BF order, then the
 *     Accomplished 3 & 4 image columns appended at the END (the eraclea
 *     dashboard reads accomplished{1-4}_image{1-6}; PB & Jay's sheet only
 *     has images for cards 1 & 2). Same rule as every brand: new columns
 *     are only ever appended at the end, never inserted.
 *
 * POST body:
 *   Monthly: { brand:'eraclea', scope:'monthly', year, month, fields:{...}, action:'save'|'approve' }
 *   Event:   { brand:'eraclea', scope:'event', eventName, eventYear, fields:{...}, action:'save'|'approve' }
 *   fields is optional on action:'approve' (approving doesn't require new content).
 */

const { ensureTab, readRows, replaceRows } = require('./config/_sheets_client');
const sheets = require('./config/sheets');

const BRAND_ID = 'eraclea';
const MONTHLY_TAB = 'eraclea';
const EVENTS_TAB = 'eraclea_events';
// Report Insights workbook (shared by every brand). config/sheets.js's
// reportInsights is used when present; this is the same file id.
const REPORT_INSIGHTS_FILE_ID = '1Fz0bEArdx54vTSGMGj-m6TYec1kizKyPubJOZNWBaLg';
const REPORT_INSIGHTS = sheets.reportInsights || REPORT_INSIGHTS_FILE_ID;

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
  'subscriptions_key_insight',                                   // BF
  // eraclea additions (appended — never insert above this line)
  'accomplished3_image1', 'accomplished3_image2', 'accomplished3_image3',
  'accomplished3_image4', 'accomplished3_image5', 'accomplished3_image6',
  'accomplished4_image1', 'accomplished4_image2', 'accomplished4_image3',
  'accomplished4_image4', 'accomplished4_image5', 'accomplished4_image6',
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
  const existing = await readRows(REPORT_INSIGHTS, tabName);

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
