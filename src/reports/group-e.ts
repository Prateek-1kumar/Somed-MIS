import { Filters, parseFilters } from '@/lib/schema';

export function r19StockItemWise(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT item_name, seg,
      SUM(closing_qt)  AS closing_qty,
      SUM(closing_va)  AS closing_value,
      SUM(near_3)      AS near_3m,
      SUM(near_6)      AS near_6m,
      SUM(near_9)      AS near_9m,
      SUM(expired)     AS expired_qty,
      ROUND(SUM(closing_qt)/NULLIF(SUM(sales_qty_)/3,0),0) AS days_of_stock
    FROM data
    ${where}
    GROUP BY item_name, seg
    ORDER BY days_of_stock DESC NULLS LAST
  `.trim();
}

export function r20StockHqWise(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT zbm, abm, hq_new,
      SUM(closing_qt)  AS closing_qty,
      SUM(closing_va)  AS closing_value,
      SUM(near_3)+SUM(near_6)+SUM(near_9) AS near_expiry_qty
    FROM data
    ${where}
    GROUP BY zbm, abm, hq_new
    ORDER BY closing_value DESC
  `.trim();
}
