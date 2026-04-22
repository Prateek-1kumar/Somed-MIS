import { Filters, parseFilters } from '@/lib/schema';

export function r6ItemWise(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_code, item_name, seg,
      MAX(pts) AS pts, MAX(pp) AS pp,
      ROUND((MAX(pts)-MAX(pp))/NULLIF(MAX(pts),0)*100,1) AS margin_pct,
      SUM(sales_qty_)  AS net_primary_qty,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
      SUM(sales_valu)-SUM(foc_val_n) AS secondary_net,
      SUM(foc_value)   AS foc_value,
      SUM(closing_qt)  AS closing_qty,
      SUM(closing_va)  AS closing_value
    FROM data
    ${where}
    GROUP BY item_code, item_name, seg
    ORDER BY achievement_pct ASC
  `.trim();
}

export function r7ItemHqPerformance(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_name, hq_new,
      SUM(net_sales_) AS net_primary
    FROM data
    ${where}
    GROUP BY item_name, hq_new
    ORDER BY item_name, hq_new
  `.trim();
}

export function r8ItemFyIncrDecr(filters: Filters): string {
  const segFilter = filters.seg ? `WHERE seg = '${filters.seg}'` : '';
  return `
    SELECT item_name, fy,
      SUM(net_sales_) AS net_primary
    FROM data
    ${segFilter}
    GROUP BY item_name, fy
    ORDER BY item_name, fy
  `.trim();
}

export function r9ItemMonthly(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_name, month, yyyymm,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      SUM(sales_valu)-SUM(foc_val_n) AS secondary_net,
      SUM(closing_va)  AS closing_value
    FROM data
    ${where}
    GROUP BY item_name, month, yyyymm
    ORDER BY item_name, yyyymm
  `.trim();
}

export function r10ItemReturn(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_name, seg,
      SUM(gri_qty)    AS gri_qty,
      SUM(gri_sales)  AS gri_value,
      SUM(rdsi_qty)   AS cn_qty,
      SUM(rdsi_sales) AS cn_value,
      SUM(gri_sales)+SUM(rdsi_sales) AS total_return_value,
      ROUND((SUM(gri_sales)+SUM(rdsi_sales))/NULLIF(SUM(net_sales_),0)*100,1) AS return_pct
    FROM data
    ${where}
    GROUP BY item_name, seg
    ORDER BY total_return_value DESC
  `.trim();
}
