import { Filters, parseFilters } from '@/lib/schema';

export function r13HqAnalysis(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT zbm, abm, hq_new,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
      SUM(sales_valu)-SUM(foc_val_n) AS secondary_net,
      SUM(coll)        AS collection,
      SUM(closing_va)  AS closing_value,
      SUM(camp_exp)+SUM(sample_exp)+SUM(mrkt_exp) AS total_exp,
      ROUND((SUM(camp_exp)+SUM(sample_exp)+SUM(mrkt_exp))/NULLIF(SUM(net_sales_),0)*100,1) AS exp_pct_of_sales
    FROM data
    ${where}
    GROUP BY zbm, abm, hq_new
    ORDER BY achievement_pct ASC NULLS LAST
  `.trim();
}

export function r14HqItemPerformance(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_name, seg,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
      SUM(closing_va)  AS closing_value
    FROM data
    ${where}
    GROUP BY item_name, seg
    ORDER BY achievement_pct ASC NULLS LAST
  `.trim();
}

export function r15HqItemFyIncrDecr(filters: Filters): string {
  const hqFilter = filters.hq_new ? `AND hq_new = '${filters.hq_new}'` : '';
  return `
    SELECT item_name, fy,
      SUM(net_sales_) AS net_primary
    FROM data
    WHERE 1=1 ${hqFilter}
    GROUP BY item_name, fy
    ORDER BY item_name, fy
  `.trim();
}

export function r16HqMonthly(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT month, yyyymm,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      SUM(coll)        AS collection,
      SUM(closing_va)  AS closing_value
    FROM data
    ${where}
    GROUP BY month, yyyymm
    ORDER BY yyyymm
  `.trim();
}

export function r17HqQuarterly(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT qtr, hly,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct
    FROM data
    ${where}
    GROUP BY qtr, hly
    ORDER BY qtr
  `.trim();
}

export function r18HqFyWise(filters: Filters): string {
  const hqFilter = filters.hq_new ? `WHERE hq_new = '${filters.hq_new}'` : '';
  return `
    SELECT fy,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
      SUM(coll) AS collection
    FROM data
    ${hqFilter}
    GROUP BY fy
    ORDER BY fy
  `.trim();
}
