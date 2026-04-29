import { buildWhere, Filters, parseFilters, ReportQuery } from '@/lib/schema';

export function r24DoctorVisitHierarchy(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT zbm, abm, tbm, hq_new, doc_code, dr_name,
        SUM(no_patient)  AS pap_patients,
        SUM(dc_patient)  AS dcpp_patients,
        SUM(camp_exp)    AS camp_exp,
        SUM(sample_exp)  AS sample_exp
      FROM data
      ${where}
      GROUP BY zbm, abm, tbm, hq_new, doc_code, dr_name
      ORDER BY zbm, abm, tbm, hq_new, dr_name
    `.trim(),
    params,
  };
}

export function r25JointWorkDetails(filters: Filters): ReportQuery {
  const { where, params } = parseFilters(filters);
  return {
    text: `
      SELECT done_by, doc_code, dr_name, hq_new, tbm,
        camp_exp, sample_exp, mrkt_exp, pap_date
      FROM data
      ${where}
      ORDER BY pap_date DESC
    `.trim(),
    params,
  };
}

export function r26HqMonthlyComparison(filters: Filters): ReportQuery {
  const { where, params } = buildWhere([['hq_new', filters.hq_new]]);
  return {
    text: `
      SELECT fy, month, yyyymm,
        SUM(net_sales_) AS net_primary
      FROM data
      ${where}
      GROUP BY fy, month, yyyymm
      ORDER BY yyyymm, fy
    `.trim(),
    params,
  };
}

export function r27ItemMonthlyComparison(filters: Filters): ReportQuery {
  const { where, params } = buildWhere([['seg', filters.seg]]);
  return {
    text: `
      SELECT item_name, fy, month, yyyymm,
        SUM(net_sales_) AS net_primary
      FROM data
      ${where}
      GROUP BY item_name, fy, month, yyyymm
      ORDER BY item_name, yyyymm, fy
    `.trim(),
    params,
  };
}
