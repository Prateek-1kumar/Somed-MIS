import { Filters, parseFilters, ReportQuery } from '@/lib/schema';

export function r11SegmentAnalysis(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT seg,
        COUNT(DISTINCT item_code) AS item_count,
        SUM(net_sales_)  AS net_primary,
        SUM(tgt_val_p)   AS target,
        ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
        SUM(sales_valu)-SUM(foc_val_n) AS secondary_net,
        SUM(foc_value)   AS foc_value
      FROM data
      ${where}
      GROUP BY seg
      ORDER BY net_primary DESC
    `.trim(),
    params,
  };
}

export function r12SegmentReturns(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT seg,
        SUM(gri_sales)   AS return_value,
        SUM(gri_qty)     AS return_qty,
        SUM(rdsi_sales)  AS cn_value,
        ROUND(SUM(gri_sales)/NULLIF(SUM(net_sales_),0)*100,1) AS return_pct_of_primary
      FROM data
      ${where}
      GROUP BY seg
      ORDER BY return_value DESC
    `.trim(),
    params,
  };
}
