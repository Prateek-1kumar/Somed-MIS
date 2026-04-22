import { Filters, parseFilters } from '@/lib/schema';

export function r21PatientSummary(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT tbm, hq_new,
      SUM(no_patient)  AS pap_patients,
      SUM(dc_patient)  AS dcpp_patients,
      SUM(no_patient)+SUM(dc_patient) AS total_patients,
      MAX(pap_date)    AS last_pap_date
    FROM data
    ${where}
    GROUP BY tbm, hq_new
    ORDER BY total_patients DESC
  `.trim();
}

export function r22HqExpenses(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT zbm, abm, hq_new,
      SUM(camp_exp)    AS camp_exp,
      SUM(sample_exp)  AS sample_exp,
      SUM(mrkt_exp)    AS mrkt_exp,
      SUM(camp_exp)+SUM(sample_exp)+SUM(mrkt_exp) AS total_exp,
      ROUND((SUM(camp_exp)+SUM(sample_exp)+SUM(mrkt_exp))/NULLIF(SUM(net_sales_),0)*100,1) AS exp_pct
    FROM data
    ${where}
    GROUP BY zbm, abm, hq_new
    ORDER BY total_exp DESC
  `.trim();
}

export function r23Dcpp(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT doc_code, dr_name, hq_new, tbm,
      SUM(dc_patient) AS dcpp_patients,
      MAX(pap_stn)    AS pap_stn,
      MAX(pap_date)   AS pap_date
    FROM data
    ${where}
    GROUP BY doc_code, dr_name, hq_new, tbm
    HAVING SUM(dc_patient) > 0
    ORDER BY dcpp_patients DESC
  `.trim();
}
