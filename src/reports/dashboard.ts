// src/reports/dashboard.ts
import { Filters, parseFilters, ReportQuery } from '@/lib/schema';

// Same as parseFilters but with the FY condition stripped — used by FY-breakdown
// queries that need to show all years regardless of the user's FY filter.
function parseFiltersNoFy(filters: Filters) {
  const { fy: _ignored, ...rest } = filters;
  return parseFilters(rest);
}

// Append a constant (no-param) AND condition to a parsed filter.
function withConstant(parsed: { where: string; params: unknown[] }, condition: string) {
  const where = parsed.where
    ? `${parsed.where} AND ${condition}`
    : `WHERE ${condition}`;
  return { where, params: parsed.params };
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────

export function dashOverviewKpis(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT
        SUM(net_sales_)                                                        AS primary_sales,
        SUM(tgt_val_p)                                                         AS primary_target,
        ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)                 AS primary_ach_pct,
        SUM(sales_valu)                                                        AS secondary_sales,
        SUM(tgt_val_s)                                                         AS secondary_target,
        ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)                 AS secondary_ach_pct,
        SUM(foc_value)                                                         AS foc_value,
        SUM(foc_qty__s + cn_qty)                                               AS foc_qty,
        SUM(sales_valu) - SUM(foc_val_n)                                      AS net_secondary
      FROM data ${where}
    `.trim(),
    params,
  };
}

export function dashOverviewFy(filters: Filters): ReportQuery {
  const { where, params } = parseFiltersNoFy(filters);
  return {
    text: `
      SELECT
        fy,
        SUM(net_sales_)                                                        AS primary_sales,
        SUM(tgt_val_p)                                                         AS primary_target,
        ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)                 AS primary_ach_pct,
        SUM(sales_valu)                                                        AS secondary_sales,
        SUM(tgt_val_s)                                                         AS secondary_target,
        ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)                 AS secondary_ach_pct,
        SUM(foc_value)                                                         AS foc_value,
        SUM(foc_qty__s + cn_qty)                                               AS foc_qty,
        SUM(sales_valu) - SUM(foc_val_n)                                      AS net_secondary
      FROM data ${where}
      GROUP BY fy
      ORDER BY fy
    `.trim(),
    params,
  };
}

// ── BRAND ────────────────────────────────────────────────────────────────────

export function dashBrand(filters: Filters): ReportQuery {
  const { where, params } = withConstant(
    parseFilters(filters),
    "item_name NOT LIKE '(INACTIVE)%'",
  );
  return {
    text: `
      SELECT
        item_name,
        seg,
        SUM(net_sales_)                AS primary_value,
        SUM(sales_qty_)                AS primary_qty,
        SUM(sales_valu)                AS secondary_value,
        SUM(sales_qty2)                AS secondary_qty,
        SUM(foc_value)                 AS foc_value,
        SUM(foc_qty__s + cn_qty)       AS foc_qty,
        SUM(sales_valu)-SUM(foc_val_n) AS net_secondary_value
      FROM data ${where}
      GROUP BY item_name, seg
      ORDER BY primary_value DESC
    `.trim(),
    params,
  };
}

// ── SEGMENT ──────────────────────────────────────────────────────────────────

export function dashSegment(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT
        seg,
        SUM(net_sales_)                AS primary_value,
        SUM(sales_qty_)                AS primary_qty,
        SUM(sales_valu)                AS secondary_value,
        SUM(sales_qty2)                AS secondary_qty,
        SUM(foc_value)                 AS foc_value,
        SUM(foc_qty__s + cn_qty)       AS foc_qty,
        SUM(sales_valu)-SUM(foc_val_n) AS net_secondary_value
      FROM data ${where}
      GROUP BY seg
      ORDER BY primary_value DESC
    `.trim(),
    params,
  };
}

// ── EXPENSES ─────────────────────────────────────────────────────────────────

export function dashExpenses(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT
        SUM(foc_value)                                                                  AS foc_value,
        SUM(sample_exp) + SUM(mrkt_exp)                                                 AS sample_mrkt_exp,
        SUM(no_patient) * 1000                                                          AS pap_patients,
        SUM(dc_patient) * 1000                                                          AS dcpp_patients,
        SUM(camp_exp)                                                                   AS camp_exp,
        SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)               AS total_expenses,
        SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)                              AS total_secondary_sales,
        ROUND(
          (SUM(foc_value)+SUM(sample_exp)+SUM(mrkt_exp)+SUM(camp_exp))
          / NULLIF(SUM(sales_valu)-SUM(foc_val_n)+SUM(foc_value),0)*100, 1)            AS exp_pct_secondary,
        SUM(sales_valu) - SUM(foc_val_n)                                               AS net_secondary_sales,
        ROUND(
          (SUM(foc_value)+SUM(sample_exp)+SUM(mrkt_exp)+SUM(camp_exp))
          / NULLIF(SUM(sales_valu)-SUM(foc_val_n),0)*100, 1)                           AS exp_pct_net_secondary
      FROM data ${where}
    `.trim(),
    params,
  };
}

// ── PRIMARY BIFURCATION ───────────────────────────────────────────────────────

export function dashPrimaryBifurcation(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT
        SUM(sale_sales)  AS sale_primary,
        SUM(gri_sales)   AS returning_primary,
        SUM(rdsi_sales)  AS rdsi_primary,
        SUM(net_sales_)  AS net_primary
      FROM data ${where}
    `.trim(),
    params,
  };
}

export function dashPrimaryBifurcationFy(filters: Filters): ReportQuery {
  const { where, params } = parseFiltersNoFy(filters);
  return {
    text: `
      SELECT
        fy,
        SUM(sale_sales)  AS sale_primary,
        SUM(gri_sales)   AS returning_primary,
        SUM(rdsi_sales)  AS rdsi_primary,
        SUM(net_sales_)  AS net_primary
      FROM data ${where}
      GROUP BY fy
      ORDER BY fy
    `.trim(),
    params,
  };
}

// ── RETURNING ─────────────────────────────────────────────────────────────────

export function dashReturning(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT
        SUM(return_amt)                                                                          AS total_returning,
        SUM(expired)                                                                             AS expired_returning,
        SUM(near_3)                                                                              AS near_3m,
        SUM(near_6)                                                                              AS near_6m,
        SUM(near_9)                                                                              AS near_9m,
        SUM(return_amt) - SUM(expired) - SUM(near_3) - SUM(near_6) - SUM(near_9)               AS above_9m,
        SUM(cn_value)                                                                            AS credit_notes
      FROM data ${where}
    `.trim(),
    params,
  };
}
