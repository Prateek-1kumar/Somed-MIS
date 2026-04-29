import { buildWhere, Filters, parseFilters, ReportQuery } from '@/lib/schema';

export function r13HqAnalysis(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
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
    `.trim(),
    params,
  };
}

export function r14HqItemPerformance(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT item_name, seg,
        SUM(net_sales_)  AS net_primary,
        SUM(tgt_val_p)   AS target,
        ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
        SUM(closing_va)  AS closing_value
      FROM data
      ${where}
      GROUP BY item_name, seg
      ORDER BY achievement_pct ASC NULLS LAST
    `.trim(),
    params,
  };
}

export function r15HqItemFyIncrDecr(filters: Filters): ReportQuery {
  const { where, params } = buildWhere([['hq_new', filters.hq_new]]);
  return {
    text: `
      SELECT item_name, fy,
        SUM(net_sales_) AS net_primary
      FROM data
      ${where}
      GROUP BY item_name, fy
      ORDER BY item_name, fy
    `.trim(),
    params,
  };
}

export function r16HqMonthly(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT month, yyyymm,
        SUM(net_sales_)  AS net_primary,
        SUM(tgt_val_p)   AS target,
        SUM(coll)        AS collection,
        SUM(closing_va)  AS closing_value
      FROM data
      ${where}
      GROUP BY month, yyyymm
      ORDER BY yyyymm
    `.trim(),
    params,
  };
}

export function r17HqQuarterly(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT qtr, hly,
        SUM(net_sales_)  AS net_primary,
        SUM(tgt_val_p)   AS target,
        ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct
      FROM data
      ${where}
      GROUP BY qtr, hly
      ORDER BY qtr
    `.trim(),
    params,
  };
}

export function r18HqFyWise(filters: Filters): ReportQuery {
  const { where, params } = buildWhere([['hq_new', filters.hq_new]]);
  return {
    text: `
      SELECT fy,
        SUM(net_sales_)  AS net_primary,
        SUM(tgt_val_p)   AS target,
        ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS achievement_pct,
        SUM(coll) AS collection
      FROM data
      ${where}
      GROUP BY fy
      ORDER BY fy
    `.trim(),
    params,
  };
}
