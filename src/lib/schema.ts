export const CSV_COLUMNS = [
  'pts','pp','co','fy','zbm','abm','tbm','hq_new','hq','customer_n',
  'yyyymm','year','qtr','hly','mth','month','seg','item_code','item_name',
  'opening_qt','opening_va','net_sales_','sales_qty_','sales_valu','sales_qty2',
  'foc_qty__s','foc_value_','sales_qty3','sales_val2','closing_qt','closing_va',
  'tgt_qty_p','tgt_val_p','tgt_qty_s','tgt_val_s','cn_qty','cn_value',
  'doc_code','dr_name','no_patient','dc_patient','pap_stn','pap_date','done_by',
  'exp_dt','camp_exp','sample_qty','sample_exp','sample_pts','mrkt_qty','mrkt_exp',
  'mrkt_pts','coll','coll_date','category','gri_qty','gri_sales','rdsi_qty',
  'rdsi_sales','sale_qty','sale_sales','net_qty','net_sales','foc_rate','foc_value',
  'foc_val_n','batch_no_','expiry_dat','return_qty','return_amt','expired',
  'near_3','near_6','near_9','remark',
] as const;

export type CsvColumn = typeof CSV_COLUMNS[number];

// Column types for DuckDB. Values outside the expected type become NULL via
// TRY_CAST rather than failing the whole load.
export const CSV_COLUMN_TYPES: Record<CsvColumn, 'VARCHAR' | 'DOUBLE'> = {
  pts: 'DOUBLE', pp: 'DOUBLE',
  co: 'VARCHAR', fy: 'VARCHAR', zbm: 'VARCHAR', abm: 'VARCHAR', tbm: 'VARCHAR',
  hq_new: 'VARCHAR', hq: 'VARCHAR', customer_n: 'VARCHAR',
  yyyymm: 'VARCHAR', year: 'DOUBLE', qtr: 'VARCHAR', hly: 'VARCHAR',
  mth: 'DOUBLE', month: 'VARCHAR',
  seg: 'VARCHAR', item_code: 'VARCHAR', item_name: 'VARCHAR',
  opening_qt: 'DOUBLE', opening_va: 'DOUBLE', net_sales_: 'DOUBLE',
  sales_qty_: 'DOUBLE', sales_valu: 'DOUBLE', sales_qty2: 'DOUBLE',
  foc_qty__s: 'DOUBLE', foc_value_: 'DOUBLE', sales_qty3: 'DOUBLE',
  sales_val2: 'DOUBLE', closing_qt: 'DOUBLE', closing_va: 'DOUBLE',
  tgt_qty_p: 'DOUBLE', tgt_val_p: 'DOUBLE', tgt_qty_s: 'DOUBLE',
  tgt_val_s: 'DOUBLE', cn_qty: 'DOUBLE', cn_value: 'DOUBLE',
  doc_code: 'VARCHAR', dr_name: 'VARCHAR',
  no_patient: 'DOUBLE', dc_patient: 'DOUBLE',
  pap_stn: 'VARCHAR', pap_date: 'VARCHAR', done_by: 'VARCHAR',
  exp_dt: 'VARCHAR', camp_exp: 'DOUBLE',
  sample_qty: 'DOUBLE', sample_exp: 'DOUBLE', sample_pts: 'DOUBLE',
  mrkt_qty: 'DOUBLE', mrkt_exp: 'DOUBLE', mrkt_pts: 'DOUBLE',
  coll: 'DOUBLE', coll_date: 'VARCHAR', category: 'VARCHAR',
  gri_qty: 'DOUBLE', gri_sales: 'DOUBLE', rdsi_qty: 'DOUBLE',
  rdsi_sales: 'DOUBLE', sale_qty: 'DOUBLE', sale_sales: 'DOUBLE',
  net_qty: 'DOUBLE', net_sales: 'DOUBLE', foc_rate: 'DOUBLE',
  foc_value: 'DOUBLE', foc_val_n: 'DOUBLE',
  batch_no_: 'VARCHAR', expiry_dat: 'VARCHAR',
  return_qty: 'DOUBLE', return_amt: 'DOUBLE', expired: 'DOUBLE',
  near_3: 'DOUBLE', near_6: 'DOUBLE', near_9: 'DOUBLE',
  remark: 'VARCHAR',
};

export interface Filters {
  fy?: string;
  zbm?: string;
  abm?: string;
  tbm?: string;
  hq_new?: string;
  seg?: string;
  qtr?: string;
  hly?: string;
  yyyymm?: string;
  month?: string;
}

export interface ValidationResult {
  valid: boolean;
  missingColumns: string[];
  blankHqNew: boolean;
}

export function validateCsvRow(row: Record<string, string>): ValidationResult {
  const missingColumns = CSV_COLUMNS.filter(col => !(col in row));
  const blankHqNew = 'hq_new' in row && row.hq_new.trim() === '';
  return {
    valid: missingColumns.length === 0 && !blankHqNew,
    missingColumns,
    blankHqNew,
  };
}

export interface ParsedFilters {
  /** Either "WHERE col = $1 AND col2 = $2" or empty string. Always safe to interpolate. */
  where: string;
  /** Param values matching the $1, $2... placeholders in `where`, in order. */
  params: unknown[];
}

/**
 * Build a parameterized WHERE clause from arbitrary column/value pairs.
 * Empty/null/undefined values are skipped. The returned `where` uses Postgres
 * positional placeholders ($1, $2, ...) starting at $1.
 *
 * Use this for custom filtering inside reports that don't take the full
 * Filters shape (e.g. r5 only honors zbm + abm).
 */
export function buildWhere(pairs: Array<[col: string, value: unknown]>): ParsedFilters {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const [col, value] of pairs) {
    if (value === undefined || value === null || value === '') continue;
    params.push(value);
    conditions.push(`${col} = $${params.length}`);
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/**
 * Build a parameterized WHERE clause from a Filters object.
 *
 * `yyyymm` is treated as text in Postgres (preserves leading zeros), so all
 * filter values are passed as their JS values without per-column casting.
 */
export function parseFilters(filters: Filters): ParsedFilters {
  return buildWhere([
    ['fy',      filters.fy],
    ['zbm',     filters.zbm],
    ['abm',     filters.abm],
    ['tbm',     filters.tbm],
    ['hq_new',  filters.hq_new],
    ['seg',     filters.seg],
    ['qtr',     filters.qtr],
    ['hly',     filters.hly],
    ['yyyymm',  filters.yyyymm],
    ['month',   filters.month],
  ]);
}

/**
 * Result of a ReportDef sqlFactory: a parameterized SQL query ready to feed
 * into `sql.unsafe(text, params)` or any pg driver that accepts positional params.
 */
export interface ReportQuery {
  text: string;
  params: unknown[];
}
