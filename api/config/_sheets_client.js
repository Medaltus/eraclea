// api/config/_sheets_client.js  (eraclea)
//
// Built 2026-10-30. The eraclea repo had no api/config/ folder, so
// run-analysis.js and run-ppc-strategy-analysis.js (ported from Just Bjorn)
// crashed on require('./config/_sheets_client'). This implements the same
// five helpers those files call, on the googleapis package already in
// package.json and the same GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env
// vars as every other route.
//
//   readRows(sheetId, tab)                     -> [{header: value}] (row 1 = headers)
//   ensureTab(sheetId, tab, headers)           -> creates the tab if missing and
//                                                 writes headers if row 1 is blank;
//                                                 returns an access token
//   appendRows(sheetId, tab, rows, token)      -> appends arrays under the data
//   replaceRows(sheetId, tab, headers, rows, token)
//                                              -> TRUE replace: clears the whole
//                                                 tab, writes ONE header row, then
//                                                 the rows (no stacked headers,
//                                                 nothing left over from before)
//   getSheetsToken()                           -> OAuth access token string
//
// Header rows and ensureTab are written RAW. Data rows (appendRows /
// replaceRows) are written USER_ENTERED — the same as typing them in — so
// numbers, TRUE/FALSE and dates keep the cell types every other brand's rows
// already have in the shared ppc_strategy tab. Mixing text "12" into a
// numeric column would make Google's CSV export blank out the minority type
// for EVERY brand's dashboard reading that tab.
//
// SAFETY (shared tabs): replaceRows refuses to run if it would shrink a tab
// that has 10+ data rows to under half its size. ppc_strategy holds every
// brand's rows (171 as of 2026-10-30); if the read of existing rows ever
// failed, a blind replace would wipe the other brands.

const { google } = require('googleapis');

let _auth = null;
function auth() {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Server is missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');
  }
  if (!_auth) {
    _auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    );
  }
  return _auth;
}
const api = () => google.sheets({ version: 'v4', auth: auth() });
const q = tab => `'${String(tab).replace(/'/g, "''")}'`;

async function getSheetsToken() {
  const { token } = await auth().getAccessToken();
  return token;
}

async function readRows(sheetId, tabName) {
  if (!sheetId) throw new Error(`readRows: no spreadsheet id for tab "${tabName}"`);
  const res = await api().spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${q(tabName)}!A1:ZZ`, valueRenderOption: 'FORMATTED_VALUE',
  });
  const values = res.data.values || [];
  if (!values.length) return [];
  const hdr = values[0].map(h => String(h == null ? '' : h).trim());
  return values.slice(1)
    .filter(v => v.some(c => String(c == null ? '' : c).trim() !== ''))
    .map(v => { const o = {}; hdr.forEach((h, i) => { if (h) o[h] = v[i] == null ? '' : String(v[i]); }); return o; });
}

async function ensureTab(sheetId, tabName, headers) {
  if (!sheetId) throw new Error(`ensureTab: no spreadsheet id for tab "${tabName}"`);
  const s = api();
  const meta = await s.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some(sh => sh.properties.title === tabName);
  if (!exists) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] } });
  }
  const row1 = await s.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${q(tabName)}!1:1` });
  const blank = !((row1.data.values || [])[0] || []).some(c => String(c || '').trim());
  if (blank && headers && headers.length) {
    await s.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${q(tabName)}!A1`, valueInputOption: 'RAW', requestBody: { values: [headers] },
    });
  }
  return getSheetsToken();
}

async function appendRows(sheetId, tabName, rows) {
  if (!rows || !rows.length) return;
  await api().spreadsheets.values.append({
    spreadsheetId: sheetId, range: `${q(tabName)}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows.map(r => r.map(c => (c == null ? '' : String(c)))) },
  });
}

async function replaceRows(sheetId, tabName, headers, rows) {
  const s = api();
  rows = rows || [];
  const cur = await s.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${q(tabName)}!A2:A` });
  const existing = (cur.data.values || []).filter(v => String(v[0] || '').trim()).length;
  if (existing >= 10 && rows.length < existing / 2) {
    throw new Error(`replaceRows: refusing to shrink "${tabName}" from ${existing} to ${rows.length} rows — existing rows may not have been read`);
  }
  await s.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${q(tabName)}!A1:ZZ` });
  await s.spreadsheets.values.update({
    spreadsheetId: sheetId, range: `${q(tabName)}!A1`, valueInputOption: 'RAW', requestBody: { values: [headers] },
  });
  if (rows.length) {
    await s.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${q(tabName)}!A2`, valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows.map(r => r.map(c => (c == null ? '' : String(c)))) },
    });
  }
}

module.exports = { readRows, ensureTab, appendRows, replaceRows, getSheetsToken };
