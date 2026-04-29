import { r6ItemWise, r7ItemHqPerformance, r8ItemFyIncrDecr, r9ItemMonthly, r10ItemReturn } from '@/reports/group-b';
import { r11SegmentAnalysis, r12SegmentReturns } from '@/reports/group-c';
import { r13HqAnalysis, r14HqItemPerformance, r15HqItemFyIncrDecr, r16HqMonthly, r17HqQuarterly, r18HqFyWise } from '@/reports/group-d';
import { r19StockItemWise, r20StockHqWise } from '@/reports/group-e';
import { r21PatientSummary, r22HqExpenses, r23Dcpp } from '@/reports/group-f';
import { r24DoctorVisitHierarchy, r25JointWorkDetails, r26HqMonthlyComparison, r27ItemMonthlyComparison } from '@/reports/group-g';
import { REPORTS, getReport, REPORT_GROUPS } from '@/reports';

it('r6 groups by item_code and item_name', () => {
  const { text } = r6ItemWise({});
  expect(text).toContain('item_code');
  expect(text).toContain('item_name');
  expect(text).toContain('achievement_pct');
});
it('r7 returns parameterless query when no filters', () => {
  const { params } = r7ItemHqPerformance({});
  expect(params).toEqual([]);
});
it('r8 ignores filters and returns empty params', () => {
  const { text, params } = r8ItemFyIncrDecr({ fy: '2025-2026' });
  expect(text).toContain('GROUP BY item_name, fy');
  expect(text).not.toContain('$1');
  expect(params).toEqual([]);
});
it('r9 includes month ordering with parameterized fy', () => {
  const { text, params } = r9ItemMonthly({ fy: '2025-2026' });
  expect(text).toContain('month');
  expect(text).toContain('fy = $1');
  expect(params).toEqual(['2025-2026']);
});
it('r10 uses gri_sales not return_amt', () => {
  const { text } = r10ItemReturn({});
  expect(text).toContain('gri_sales');
  expect(text).not.toContain('return_amt');
});
it('r11 groups by seg', () => {
  const { text } = r11SegmentAnalysis({});
  expect(text).toContain('GROUP BY seg');
});
it('r12 returns return_pct_of_primary', () => {
  const { text } = r12SegmentReturns({});
  expect(text).toContain('return_pct_of_primary');
});
it('r13 includes camp_exp and mrkt_exp', () => {
  const { text } = r13HqAnalysis({});
  expect(text).toContain('camp_exp');
  expect(text).toContain('mrkt_exp');
  expect(text).toContain('exp_pct_of_sales');
});
it('r15 only honors hq_new in its custom filter', () => {
  const { text, params } = r15HqItemFyIncrDecr({ hq_new: 'AGRA', fy: '2025-2026' });
  expect(text).toContain('hq_new = $1');
  expect(text).not.toContain('fy = $');
  expect(params).toEqual(['AGRA']);
});
it('r16 filters by hq_new with placeholder', () => {
  const { text, params } = r16HqMonthly({ hq_new: 'AGRA' });
  expect(text).toContain('hq_new = $1');
  expect(text).toContain('month');
  expect(params).toEqual(['AGRA']);
});
it('r17 groups by quarter', () => {
  const { text } = r17HqQuarterly({});
  expect(text).toContain('GROUP BY qtr, hly');
});
it('r18 filters by hq_new with WHERE placeholder', () => {
  const { text, params } = r18HqFyWise({ hq_new: 'HARDA' });
  expect(text).toContain('hq_new = $1');
  expect(text).toContain('GROUP BY fy');
  expect(params).toEqual(['HARDA']);
});
it('r19 includes expiry buckets and days_of_stock', () => {
  const { text } = r19StockItemWise({});
  expect(text).toContain('near_3');
  expect(text).toContain('days_of_stock');
});
it('r20 groups by hq_new', () => {
  const { text } = r20StockHqWise({});
  expect(text).toContain('GROUP BY zbm, abm, hq_new');
});
it('r21 groups by tbm and hq_new', () => {
  const { text } = r21PatientSummary({});
  expect(text).toContain('GROUP BY tbm, hq_new');
});
it('r22 includes expense percentage', () => {
  const { text } = r22HqExpenses({});
  expect(text).toContain('exp_pct');
  expect(text).toContain('mrkt_exp');
});
it('r23 filters HAVING dc_patient > 0', () => {
  const { text } = r23Dcpp({});
  expect(text).toContain('HAVING');
  expect(text).toContain('dc_patient');
});
it('r24 includes full hierarchy columns', () => {
  const { text } = r24DoctorVisitHierarchy({});
  expect(text).toContain('zbm');
  expect(text).toContain('abm');
  expect(text).toContain('tbm');
  expect(text).toContain('doc_code');
});
it('r25 orders by pap_date DESC', () => {
  const { text } = r25JointWorkDetails({});
  expect(text).toContain('ORDER BY pap_date DESC');
});
it('r26 groups by fy for cross-year comparison with hq_new placeholder', () => {
  const { text, params } = r26HqMonthlyComparison({ hq_new: 'AGRA' });
  expect(text).toContain('fy');
  expect(text).toContain('hq_new = $1');
  expect(params).toEqual(['AGRA']);
});
it('r27 groups by item_name and fy with seg placeholder', () => {
  const { text, params } = r27ItemMonthlyComparison({ seg: 'NEURO' });
  expect(text).toContain('item_name');
  expect(text).toContain('fy');
  expect(text).toContain('seg = $1');
  expect(params).toEqual(['NEURO']);
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
