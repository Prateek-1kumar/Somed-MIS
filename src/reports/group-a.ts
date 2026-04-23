import { Filters, parseFilters } from '@/lib/schema';

export function r1SalesAnalysis(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT zbm, abm, hq_new,
      SUM(sale_sales)  AS primary_sale,
      SUM(gri_sales)   AS primary_return,
      SUM(rdsi_sales)  AS primary_cn,
      SUM(net_sales_)  AS net_primary,
      SUM(tgt_val_p)   AS target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
      SUM(sales_valu) - SUM(foc_val_n) AS secondary_net,
      SUM(foc_value)   AS foc_value,
      SUM(coll)        AS collection,
      SUM(closing_va)  AS closing_value
    FROM data
    ${where}
    GROUP BY zbm, abm, hq_new
    ORDER BY achievement_pct ASC
  `.trim();
}

export function r2PrimaryBifurcation(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT zbm, abm, hq_new,
      SUM(sale_sales)  AS gross_primary,
      SUM(gri_sales)   AS gri_return,
      SUM(rdsi_sales)  AS cn_deduction,
      SUM(net_sales_)  AS net_primary,
      ROUND(SUM(gri_sales)/NULLIF(SUM(sale_sales),0)*100,1) AS return_pct
    FROM data
    ${where}
    GROUP BY zbm, abm, hq_new
    ORDER BY hq_new
  `.trim();
}

export function r3ReturningExpiry(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_name, seg,
      SUM(gri_qty)    AS return_qty,
      SUM(gri_sales)  AS return_value,
      SUM(near_3)     AS near_3m,
      SUM(near_6)     AS near_6m,
      SUM(near_9)     AS near_9m,
      SUM(expired)    AS expired_qty,
      SUM(near_3)+SUM(near_6)+SUM(near_9)+SUM(expired) AS total_at_risk
    FROM data
    ${where}
    GROUP BY item_name, seg
    ORDER BY total_at_risk DESC
  `.trim();
}

export function r4StockistAnalysis(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT customer_n, hq_new,
      SUM(net_sales_)  AS net_primary,
      SUM(sales_valu) - SUM(foc_val_n) AS secondary_net,
      SUM(coll)        AS collection,
      SUM(closing_va)  AS closing_value,
      SUM(net_sales_) - SUM(coll) AS outstanding
    FROM data
    ${where}
    GROUP BY customer_n, hq_new
    ORDER BY outstanding DESC
  `.trim();
}

export function r5HqFyIncrDecr(filters: Filters): string {
  const zbmFilter = filters.zbm ? `AND zbm = '${filters.zbm}'` : '';
  const abmFilter = filters.abm ? `AND abm = '${filters.abm}'` : '';
  return `
    SELECT hq_new, fy,
      SUM(net_sales_) AS net_primary
    FROM data
    WHERE 1=1 ${zbmFilter} ${abmFilter}
    GROUP BY hq_new, fy
    ORDER BY hq_new, fy
  `.trim();
}
