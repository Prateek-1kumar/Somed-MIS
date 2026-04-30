// One human-readable description per column in the `data` table. Injected
// verbatim into the chat agent's system prompt on every turn. The 75-row
// dictionary fits in ~2,250 tokens — small enough to always include, which
// removes the need to retrieve column docs.
//
// Source-of-truth precedence when authoring/editing:
//   1. The formula dictionary in src/lib/agent/power-prompt.md.
//   2. The report SQL in src/reports/*.ts (canonical usage).
//   3. CSV_COLUMN_TYPES in src/lib/schema.ts.
//
// Format: "<type>: <one-line meaning>. Examples: a, b, c"
//   - For confusable columns, EXPLICITLY name what they are NOT.
//   - For sign-coded columns, state whether values are negative.
//
// `Record<CsvColumn, string>` enforces compile-time exhaustiveness — adding
// a new CsvColumn without a description fails the build.

import type { CsvColumn } from './schema';

export const COLUMN_DESCRIPTIONS: Record<CsvColumn, string> = {
  // ── Hierarchy / org ────────────────────────────────────────────────────
  pts:        'numeric: points (legacy, low signal). Examples: 12, 0, 1.5',
  pp:         'numeric: previous-period reference (legacy). Examples: 0, 4500',
  co:         'text: company / division code. Examples: SHM, SHN',
  fy:         'text: financial year in Indian format (April–March). Examples: "2024-2025", "2025-2026"',
  zbm:        'text: Zonal Business Manager code. Examples: "ZBM-NORTH", "ZBM-WEST"',
  abm:        'text: Area Business Manager code. Examples: "ABM-DEL", "ABM-MUM"',
  tbm:        'text: Territory Business Manager code. Examples: "TBM-DEL-1"',
  hq_new:     'text: current HQ assignment. Use this (NOT hq) for HQ-level breakdowns. Examples: "DEL-04", "MUM-02"',
  hq:         'text: legacy HQ assignment (pre-restructuring). Prefer hq_new.',
  customer_n: 'text: stockist / customer name. Examples: "ABC Pharma", "XYZ Distributors"',

  // ── Period ─────────────────────────────────────────────────────────────
  yyyymm:     'text (TEXT, NOT integer — preserves leading zeros): year-month period. Examples: "202504", "202601"',
  year:       'numeric: calendar year. Examples: 2025, 2026',
  qtr:        'text: quarter label. Examples: "Q1", "Q2", "Q3", "Q4"',
  hly:        'text: half-yearly label. Examples: "H1", "H2"',
  mth:        'numeric: month number 1-12.',
  month:      'text: month name. Examples: "Apr", "May"',

  // ── Item / segment ─────────────────────────────────────────────────────
  seg:        'text: therapeutic segment. Examples: "NEURO", "CARDIO", "GASTRO"',
  item_code:  'text: SKU code. Examples: "CRO650-10", "DOLO-15"',
  item_name:  'text: full SKU name. Use UPPER(substring(item_name from \'^[A-Za-z][A-Za-z0-9]*\')) to extract the brand family (e.g. CROCIN). EXCLUDE inactive items via NOT LIKE \'(INACTIVE)%\'. Examples: "Crocin-650 10x10", "Dolo-650"',

  // ── Stock movement ─────────────────────────────────────────────────────
  opening_qt: 'numeric: opening stock quantity (units).',
  opening_va: 'numeric: opening stock value (₹).',
  closing_qt: 'numeric: closing stock quantity (units).',
  closing_va: 'numeric: closing stock value (₹). Used by KPI: Closing Value = SUM(closing_va).',

  // ── PRIMARY sales (sales TO stockists) ─────────────────────────────────
  // CRITICAL: "primary sales" is the default sales reading in this dataset.
  net_sales_: 'numeric: PRIMARY SALES NET OF RETURNS — the default "sales" reading. The TRAILING UNDERSCORE is intentional. DO NOT use "net_sales" (no underscore) — that is a different, narrower column. Formula: SUM(net_sales_). Examples: 12450.50, 0, -345.20',
  net_sales:  'numeric: distinct from net_sales_ — narrower aggregation, rarely used. Prefer net_sales_ for "primary sales".',
  net_qty:    'numeric: net primary qty.',
  sale_sales: 'numeric: GROSS PRIMARY SALES (before returns/credit notes). Formula: SUM(sale_sales).',
  sale_qty:   'numeric: gross primary qty.',
  gri_sales:  'numeric: PRIMARY RETURNS — STORED AS NEGATIVE VALUES. To compute net = sale_sales + gri_sales (NOT subtract — sign is in the data).',
  gri_qty:    'numeric: primary return qty (typically negative).',
  rdsi_sales: 'numeric: RDSI / credit-note deductions on primary — STORED AS NEGATIVE VALUES. Subtract by adding (sign already in data).',
  rdsi_qty:   'numeric: rdsi qty (typically negative).',

  // ── PRIMARY targets ────────────────────────────────────────────────────
  tgt_val_p:  'numeric: PRIMARY TARGET VALUE (₹). Formula: SUM(tgt_val_p). Achievement % = ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100, 1)',
  tgt_qty_p:  'numeric: primary target qty.',

  // ── SECONDARY sales (sales FROM stockists to retailers) ────────────────
  sales_valu: 'numeric: SECONDARY SALES VALUE (₹). Note the spelling — sales_VALU (no E). Formula: SUM(sales_valu). Examples: 8200, 0',
  sales_qty_: 'numeric: PRIMARY qty (with trailing underscore). NOT secondary qty — see sales_qty2.',
  sales_qty2: 'numeric: secondary qty.',
  sales_qty3: 'numeric: tertiary qty (rarely used).',
  sales_val2: 'numeric: secondary value (alternate column, low usage).',

  // ── SECONDARY targets ──────────────────────────────────────────────────
  tgt_val_s:  'numeric: SECONDARY TARGET VALUE. Achievement % = ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100, 1)',
  tgt_qty_s:  'numeric: secondary target qty.',

  // ── FOC (free-of-cost) ─────────────────────────────────────────────────
  // CRITICAL: three nearly identical column names; do not confuse.
  foc_value:  'numeric: FOC VALUE (₹) — the canonical FOC value column. Formula: SUM(foc_value). DO NOT use foc_value_ or foc_val_n.',
  foc_value_: 'numeric: legacy/alternate FOC value (NOT the canonical FOC). Prefer foc_value.',
  foc_val_n:  'numeric: NET-SECONDARY FOC ADJUSTMENT. Used only in the formula: SUM(sales_valu) - SUM(foc_val_n). NOT a standalone FOC value.',
  foc_qty__s: 'numeric: FOC qty (DOUBLE underscore + s suffix). Formula component: SUM(foc_qty__s + cn_qty) for FOC qty.',
  foc_rate:   'numeric: FOC rate (per unit).',
  cn_qty:     'numeric: credit-note qty. Combined with foc_qty__s in FOC formulas.',
  cn_value:   'numeric: credit-note value.',

  // ── Doctors / patients ─────────────────────────────────────────────────
  doc_code:   'text: doctor identifier code (foreign key into the doctor master). Examples: "DOC-12453", "DOC-99001"',
  dr_name:    'text: doctor full name. Examples: "Dr. Sharma A", "Dr. Patel R"',
  no_patient: 'numeric: PAP patients (in thousands). Formula: SUM(no_patient) * 1000.',
  dc_patient: 'numeric: DCPP patients (in thousands). Formula: SUM(dc_patient) * 1000.',
  pap_stn:    'text: PAP station / center.',
  pap_date:   'text (date as TEXT — CSV uses "/  /" sentinel). PAP visit date.',
  done_by:    'text: who recorded the entry.',

  // ── Expiry / returns ───────────────────────────────────────────────────
  return_qty: 'numeric: total return quantity (may be negative).',
  return_amt: 'numeric: TOTAL RETURNING (₹). May be negative. Formula: SUM(return_amt). Long-expiry (>9m) = SUM(return_amt) - SUM(expired) - SUM(near_3) - SUM(near_6) - SUM(near_9)',
  expired:    'numeric: EXPIRED RETURN VALUE. Formula: SUM(expired).',
  near_3:     'numeric: returns with ≤3-month expiry remaining. Formula: SUM(near_3).',
  near_6:     'numeric: returns with ≤6-month expiry remaining. Formula: SUM(near_6).',
  near_9:     'numeric: returns with ≤9-month expiry remaining. Formula: SUM(near_9).',
  exp_dt:     'text (date as TEXT). Expiry date.',
  expiry_dat: 'text (date as TEXT). Expiry date alternate.',
  batch_no_:  'text: batch number (trailing underscore in column name).',

  // ── Expenses ───────────────────────────────────────────────────────────
  camp_exp:   'numeric: campaign expenses. Component of total_expenses.',
  sample_qty: 'numeric: sample quantity distributed.',
  sample_exp: 'numeric: SAMPLE EXPENSES. Component of: SUM(foc_value)+SUM(sample_exp)+SUM(mrkt_exp)+SUM(camp_exp).',
  sample_pts: 'numeric: sample points (legacy).',
  mrkt_qty:   'numeric: marketing qty.',
  mrkt_exp:   'numeric: MARKETING EXPENSES. Component of total_expenses.',
  mrkt_pts:   'numeric: marketing points (legacy).',

  // ── Collection / misc ──────────────────────────────────────────────────
  coll:       'numeric: collection (₹). Outstanding = SUM(net_sales_) - SUM(coll).',
  coll_date:  'text (date as TEXT). Collection date.',
  category:   'text: customer/product category label.',
  remark:     'text: free-form remark.',
};
