import { Filters } from '@/lib/schema';
import { r1SalesAnalysis, r2PrimaryBifurcation, r3ReturningExpiry, r4StockistAnalysis, r5HqFyIncrDecr } from './group-a';
import { r6ItemWise, r7ItemHqPerformance, r8ItemFyIncrDecr, r9ItemMonthly, r10ItemReturn } from './group-b';
import { r11SegmentAnalysis, r12SegmentReturns } from './group-c';
import { r13HqAnalysis, r14HqItemPerformance, r15HqItemFyIncrDecr, r16HqMonthly, r17HqQuarterly, r18HqFyWise } from './group-d';
import { r19StockItemWise, r20StockHqWise } from './group-e';
import { r21PatientSummary, r22HqExpenses, r23Dcpp } from './group-f';
import { r24DoctorVisitHierarchy, r25JointWorkDetails, r26HqMonthlyComparison, r27ItemMonthlyComparison } from './group-g';

export type ChartType = 'bar' | 'line' | 'pie' | 'stacked-bar' | 'heatmap' | 'table-only';

export interface ReportDef {
  id: string;
  name: string;
  group: string;
  chartType: ChartType;
  defaultChartKey?: string;
  sqlFactory: (filters: Filters) => string;
}

export const REPORTS: ReportDef[] = [
  { id: 'r1', name: 'Sales Analysis', group: 'Sales', chartType: 'bar', defaultChartKey: 'net_primary', sqlFactory: r1SalesAnalysis },
  { id: 'r2', name: 'Sales Analysis [Primary Bifurcation]', group: 'Sales', chartType: 'stacked-bar', defaultChartKey: 'net_primary', sqlFactory: r2PrimaryBifurcation },
  { id: 'r3', name: 'Returning-Expiry Bifurcation', group: 'Sales', chartType: 'stacked-bar', defaultChartKey: 'total_at_risk', sqlFactory: r3ReturningExpiry },
  { id: 'r4', name: 'Sales Analysis (SMW/Stockist)', group: 'Sales', chartType: 'bar', defaultChartKey: 'outstanding', sqlFactory: r4StockistAnalysis },
  { id: 'r5', name: 'HQ-Wise FY Incr/Decr', group: 'Sales', chartType: 'bar', defaultChartKey: 'net_primary', sqlFactory: r5HqFyIncrDecr },
  { id: 'r6', name: 'Item-Wise Analysis', group: 'Item-Wise', chartType: 'bar', defaultChartKey: 'achievement_pct', sqlFactory: r6ItemWise },
  { id: 'r7', name: 'Item-Wise HQ/ABM/ZBM Performance', group: 'Item-Wise', chartType: 'heatmap', sqlFactory: r7ItemHqPerformance },
  { id: 'r8', name: 'Item-Wise FY Incr/Decr', group: 'Item-Wise', chartType: 'bar', defaultChartKey: 'net_primary', sqlFactory: r8ItemFyIncrDecr },
  { id: 'r9', name: 'Item-Wise Monthly', group: 'Item-Wise', chartType: 'line', defaultChartKey: 'net_primary', sqlFactory: r9ItemMonthly },
  { id: 'r10', name: 'Item-Wise Return', group: 'Item-Wise', chartType: 'bar', defaultChartKey: 'total_return_value', sqlFactory: r10ItemReturn },
  { id: 'r11', name: 'Segment-Wise Analysis', group: 'Segment', chartType: 'pie', defaultChartKey: 'net_primary', sqlFactory: r11SegmentAnalysis },
  { id: 'r12', name: 'Segment-Wise Return Analysis', group: 'Segment', chartType: 'bar', defaultChartKey: 'return_value', sqlFactory: r12SegmentReturns },
  { id: 'r13', name: 'Head-Quarter Wise Analysis', group: 'HQ-Wise', chartType: 'bar', defaultChartKey: 'achievement_pct', sqlFactory: r13HqAnalysis },
  { id: 'r14', name: 'HQ Item-Wise Performance', group: 'HQ-Wise', chartType: 'bar', defaultChartKey: 'achievement_pct', sqlFactory: r14HqItemPerformance },
  { id: 'r15', name: 'HQ Item-Wise FY Incr/Decr', group: 'HQ-Wise', chartType: 'bar', defaultChartKey: 'net_primary', sqlFactory: r15HqItemFyIncrDecr },
  { id: 'r16', name: 'HQ-Wise Monthly', group: 'HQ-Wise', chartType: 'line', defaultChartKey: 'net_primary', sqlFactory: r16HqMonthly },
  { id: 'r17', name: 'HQ-Wise Quarterly', group: 'HQ-Wise', chartType: 'bar', defaultChartKey: 'achievement_pct', sqlFactory: r17HqQuarterly },
  { id: 'r18', name: 'HQ-Wise FY Wise', group: 'HQ-Wise', chartType: 'line', defaultChartKey: 'net_primary', sqlFactory: r18HqFyWise },
  { id: 'r19', name: 'Closing Stock (Item-Wise)', group: 'Stock', chartType: 'bar', defaultChartKey: 'closing_value', sqlFactory: r19StockItemWise },
  { id: 'r20', name: 'Closing Stock (HQ-Wise)', group: 'Stock', chartType: 'bar', defaultChartKey: 'closing_value', sqlFactory: r20StockHqWise },
  { id: 'r21', name: 'Patient Summary', group: 'Expenses', chartType: 'bar', defaultChartKey: 'total_patients', sqlFactory: r21PatientSummary },
  { id: 'r22', name: 'HQ Expenses Summary', group: 'Expenses', chartType: 'stacked-bar', defaultChartKey: 'total_exp', sqlFactory: r22HqExpenses },
  { id: 'r23', name: 'D.C.P.P.', group: 'Expenses', chartType: 'table-only', sqlFactory: r23Dcpp },
  { id: 'r24', name: "Doctor's Visit All-Hierarchy", group: 'Field', chartType: 'table-only', sqlFactory: r24DoctorVisitHierarchy },
  { id: 'r25', name: 'Joint Work Details', group: 'Field', chartType: 'table-only', sqlFactory: r25JointWorkDetails },
  { id: 'r26', name: 'HQ-Wise Monthly Comparison', group: 'Field', chartType: 'bar', defaultChartKey: 'net_primary', sqlFactory: r26HqMonthlyComparison },
  { id: 'r27', name: 'Item-Wise Monthly Comparison', group: 'Field', chartType: 'bar', defaultChartKey: 'net_primary', sqlFactory: r27ItemMonthlyComparison },
];

export const REPORT_GROUPS = [...new Set(REPORTS.map(r => r.group))];

export function getReport(id: string): ReportDef | undefined {
  return REPORTS.find(r => r.id === id);
}
