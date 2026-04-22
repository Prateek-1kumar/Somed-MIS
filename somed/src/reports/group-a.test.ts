import { r1SalesAnalysis, r2PrimaryBifurcation, r3ReturningExpiry, r4StockistAnalysis, r5HqFyIncrDecr } from '@/reports/group-a';

describe('r1SalesAnalysis', () => {
  it('contains GROUP BY hq_new and key metrics', () => {
    const sql = r1SalesAnalysis({});
    expect(sql).toContain('hq_new');
    expect(sql).toContain('SUM(net_sales_)');
    expect(sql).toContain('SUM(tgt_val_p)');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('FROM data');
  });
  it('applies fy filter', () => {
    const sql = r1SalesAnalysis({ fy: '2025-2026' });
    expect(sql).toContain(`fy = '2025-2026'`);
  });
  it('includes achievement_pct calculation', () => {
    const sql = r1SalesAnalysis({});
    expect(sql).toContain('achievement_pct');
    expect(sql).toContain('NULLIF');
  });
});

describe('r2PrimaryBifurcation', () => {
  it('splits sale, return, CN components', () => {
    const sql = r2PrimaryBifurcation({});
    expect(sql).toContain('sale_sales');
    expect(sql).toContain('gri_sales');
    expect(sql).toContain('rdsi_sales');
    expect(sql).toContain('net_sales_');
  });
});

describe('r3ReturningExpiry', () => {
  it('uses gri_sales NOT return_amt', () => {
    const sql = r3ReturningExpiry({});
    expect(sql).toContain('gri_sales');
    expect(sql).not.toContain('return_amt');
  });
  it('includes expiry buckets', () => {
    const sql = r3ReturningExpiry({});
    expect(sql).toContain('near_3');
    expect(sql).toContain('near_6');
    expect(sql).toContain('near_9');
    expect(sql).toContain('expired');
  });
});

describe('r4StockistAnalysis', () => {
  it('groups by customer_n', () => {
    const sql = r4StockistAnalysis({});
    expect(sql).toContain('customer_n');
    expect(sql).toContain('GROUP BY');
  });
  it('computes outstanding', () => {
    const sql = r4StockistAnalysis({});
    expect(sql).toContain('outstanding');
    expect(sql).toContain('coll');
  });
});

describe('r5HqFyIncrDecr', () => {
  it('groups by hq_new and fy', () => {
    const sql = r5HqFyIncrDecr({});
    expect(sql).toContain('hq_new');
    expect(sql).toContain('fy');
    expect(sql).toContain('GROUP BY');
  });
  it('applies zbm filter when provided', () => {
    const sql = r5HqFyIncrDecr({ zbm: 'ZBM MP' });
    expect(sql).toContain(`zbm = 'ZBM MP'`);
  });
});
