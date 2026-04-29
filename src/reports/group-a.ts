import { buildWhere, Filters, parseFilters, ReportQuery } from '@/lib/schema';

export function r1SalesAnalysis(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
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
    `.trim(),
    params,
  };
}

export function r2PrimaryBifurcation(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
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
    `.trim(),
    params,
  };
}

export function r3ReturningExpiry(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
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
    `.trim(),
    params,
  };
}

export function r4StockistAnalysis(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
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
    `.trim(),
    params,
  };
}

export function r5HqFyIncrDecr(filters: Filters): ReportQuery {
  const { where, params } = buildWhere([
    ['zbm', filters.zbm],
    ['abm', filters.abm],
  ]);
  return {
    text: `
      SELECT hq_new, fy,
        SUM(net_sales_) AS net_primary
      FROM data
      ${where}
      GROUP BY hq_new, fy
      ORDER BY hq_new, fy
    `.trim(),
    params,
  };
}
