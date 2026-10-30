// api/config/sheets.js  (eraclea)
//
// Spreadsheet (file) ids the backend reads/writes, by key. Built
// 2026-10-30 FROM THE SAME SHEET_CONFIG env var the dashboard uses, so
// adding or changing a sheet there (e.g. SHEET_INSIGHTS) takes effect on
// the next deploy with no code change. Every backend route finds the
// eraclea data inside each workbook by TAB NAME ('eraclea' — see
// brands.js), so only file ids are needed here.

let cfg = {};
try { cfg = JSON.parse(process.env.SHEET_CONFIG || '{}'); } catch (e) {
  console.error('[config/sheets] SHEET_CONFIG env var is not valid JSON:', e.message);
}
const id = k => (cfg[k] && cfg[k].fileId) || undefined;

module.exports = {
  businessReport:         id('SHEET_BUSINESS_REPORT'),
  searchQueryPerformance: id('SHEET_SEARCH_QUERY_PERFORMANCE'),
  advertising:            id('SHEET_ADVERTISING'),
  adOrders:               id('SHEET_AD_ORDERS'),
  adSearchTerms:          id('SHEET_AD_SEARCH_TERMS'),
  listingAudit:           id('SHEET_LISTING_AUDIT'),
  insights:               id('SHEET_INSIGHTS'),
  productInventory:       id('SHEET_PRODUCT_INVENTORY'),
  newdermInventory:       id('SHEET_NEWDERM_INVENTORY'),
  keywordTracker:         id('SHEET_KEYWORD_TRACKER'),
  reportInsights:         id('SHEET_REPORT_INSIGHTS'),
  orders:                 id('SHEET_ORDERS'),
  returns:                id('SHEET_RETURNS'),
  masterSkuList:          id('SHEET_MASTER_SKU_LIST'),
};
