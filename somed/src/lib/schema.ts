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

export function parseFilters(filters: Filters): string {
  const conditions: string[] = [];
  if (filters.fy) conditions.push(`fy = '${filters.fy}'`);
  if (filters.zbm) conditions.push(`zbm = '${filters.zbm}'`);
  if (filters.abm) conditions.push(`abm = '${filters.abm}'`);
  if (filters.tbm) conditions.push(`tbm = '${filters.tbm}'`);
  if (filters.hq_new) conditions.push(`hq_new = '${filters.hq_new}'`);
  if (filters.seg) conditions.push(`seg = '${filters.seg}'`);
  if (filters.qtr) conditions.push(`qtr = '${filters.qtr}'`);
  if (filters.hly) conditions.push(`hly = '${filters.hly}'`);
  if (filters.yyyymm) conditions.push(`yyyymm = ${filters.yyyymm}`);
  if (filters.month) conditions.push(`month = '${filters.month}'`);
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}
