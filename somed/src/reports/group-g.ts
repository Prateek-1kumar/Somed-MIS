import { Filters, parseFilters } from '@/lib/schema';

export function r24DoctorVisitHierarchy(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT zbm, abm, tbm, hq_new, doc_code, dr_name,
      SUM(no_patient)  AS pap_patients,
      SUM(dc_patient)  AS dcpp_patients,
      SUM(camp_exp)    AS camp_exp,
      SUM(sample_exp)  AS sample_exp
    FROM data
    ${where}
    GROUP BY zbm, abm, tbm, hq_new, doc_code, dr_name
    ORDER BY zbm, abm, tbm, hq_new, dr_name
  `.trim();
}

export function r25JointWorkDetails(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT done_by, doc_code, dr_name, hq_new, tbm,
      camp_exp, sample_exp, mrkt_exp, pap_date
    FROM data
    ${where}
    ORDER BY pap_date DESC
  `.trim();
}

export function r26HqMonthlyComparison(filters: Filters): string {
  const hqFilter = filters.hq_new ? `AND hq_new = '${filters.hq_new}'` : '';
  return `
    SELECT fy, month, yyyymm,
      SUM(net_sales_) AS net_primary
    FROM data
    WHERE 1=1 ${hqFilter}
    GROUP BY fy, month, yyyymm
    ORDER BY yyyymm, fy
  `.trim();
}

export function r27ItemMonthlyComparison(filters: Filters): string {
  const itemFilter = filters.seg ? `AND seg = '${filters.seg}'` : '';
  return `
    SELECT item_name, fy, month, yyyymm,
      SUM(net_sales_) AS net_primary
    FROM data
    WHERE 1=1 ${itemFilter}
    GROUP BY item_name, fy, month, yyyymm
    ORDER BY item_name, yyyymm, fy
  `.trim();
}
