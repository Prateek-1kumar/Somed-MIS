import { r6ItemWise, r7ItemHqPerformance, r8ItemFyIncrDecr, r9ItemMonthly, r10ItemReturn } from '@/reports/group-b';
import { r11SegmentAnalysis, r12SegmentReturns } from '@/reports/group-c';
import { r13HqAnalysis, r14HqItemPerformance, r15HqItemFyIncrDecr, r16HqMonthly, r17HqQuarterly, r18HqFyWise } from '@/reports/group-d';
import { r19StockItemWise, r20StockHqWise } from '@/reports/group-e';
import { r21PatientSummary, r22HqExpenses, r23Dcpp } from '@/reports/group-f';
import { r24DoctorVisitHierarchy, r25JointWorkDetails, r26HqMonthlyComparison, r27ItemMonthlyComparison } from '@/reports/group-g';
import { REPORTS, getReport, REPORT_GROUPS } from '@/reports';

it('r6 groups by item_code and item_name', () => {
  expect(r6ItemWise({})).toContain('item_code');
  expect(r6ItemWise({})).toContain('item_name');
  expect(r6ItemWise({})).toContain('achievement_pct');
});
it('r9 includes month ordering', () => {
  expect(r9ItemMonthly({ fy: '2025-2026' })).toContain('month');
  expect(r9ItemMonthly({ fy: '2025-2026' })).toContain("fy = '2025-2026'");
});
it('r10 uses gri_sales not return_amt', () => {
  expect(r10ItemReturn({})).toContain('gri_sales');
  expect(r10ItemReturn({})).not.toContain('return_amt');
});
it('r11 groups by seg', () => {
  expect(r11SegmentAnalysis({})).toContain('GROUP BY seg');
});
it('r12 returns return_pct_of_primary', () => {
  expect(r12SegmentReturns({})).toContain('return_pct_of_primary');
});
it('r13 includes camp_exp and mrkt_exp', () => {
  expect(r13HqAnalysis({})).toContain('camp_exp');
  expect(r13HqAnalysis({})).toContain('mrkt_exp');
  expect(r13HqAnalysis({})).toContain('exp_pct_of_sales');
});
it('r16 filters by hq_new', () => {
  expect(r16HqMonthly({ hq_new: 'AGRA' })).toContain("hq_new = 'AGRA'");
  expect(r16HqMonthly({ hq_new: 'AGRA' })).toContain('month');
});
it('r18 filters by hq_new with WHERE', () => {
  const sql = r18HqFyWise({ hq_new: 'HARDA' });
  expect(sql).toContain("hq_new = 'HARDA'");
  expect(sql).toContain('GROUP BY fy');
});
it('r19 includes expiry buckets and days_of_stock', () => {
  expect(r19StockItemWise({})).toContain('near_3');
  expect(r19StockItemWise({})).toContain('days_of_stock');
});
it('r22 includes expense percentage', () => {
  expect(r22HqExpenses({})).toContain('exp_pct');
  expect(r22HqExpenses({})).toContain('mrkt_exp');
});
it('r23 filters HAVING dc_patient > 0', () => {
  expect(r23Dcpp({})).toContain('HAVING');
  expect(r23Dcpp({})).toContain('dc_patient');
});
it('r26 groups by fy for cross-year comparison', () => {
  expect(r26HqMonthlyComparison({ hq_new: 'AGRA' })).toContain('fy');
  expect(r26HqMonthlyComparison({ hq_new: 'AGRA' })).toContain("hq_new = 'AGRA'");
});
it('r27 groups by item_name and fy', () => {
  expect(r27ItemMonthlyComparison({})).toContain('item_name');
  expect(r27ItemMonthlyComparison({})).toContain('fy');
});
it('registry has exactly 27 reports', () => {
  expect(REPORTS).toHaveLength(27);
});
it('getReport returns correct report by id', () => {
  expect(getReport('r1')?.name).toBe('Sales Analysis');
  expect(getReport('r27')?.name).toBe('Item-Wise Monthly Comparison');
  expect(getReport('r99')).toBeUndefined();
});
it('REPORT_GROUPS has 7 groups', () => {
  expect(REPORT_GROUPS).toHaveLength(7);
  expect(REPORT_GROUPS).toContain('Sales');
  expect(REPORT_GROUPS).toContain('HQ-Wise');
});
