import { r1SalesAnalysis, r2PrimaryBifurcation, r3ReturningExpiry, r4StockistAnalysis, r5HqFyIncrDecr } from '@/reports/group-a';

describe('r1SalesAnalysis', () => {
  it('contains GROUP BY hq_new and key metrics', () => {
    const { text } = r1SalesAnalysis({});
    expect(text).toContain('hq_new');
    expect(text).toContain('SUM(net_sales_)');
    expect(text).toContain('SUM(tgt_val_p)');
    expect(text).toContain('GROUP BY');
    expect(text).toContain('FROM data');
  });
  it('applies fy filter as parameterized placeholder', () => {
    const { text, params } = r1SalesAnalysis({ fy: '2025-2026' });
    expect(text).toContain('fy = $1');
    expect(text).not.toContain(`'2025-2026'`);
    expect(params).toEqual(['2025-2026']);
  });
  it('includes achievement_pct calculation', () => {
    const { text } = r1SalesAnalysis({});
    expect(text).toContain('achievement_pct');
    expect(text).toContain('NULLIF');
  });
  it('returns empty params with no filters', () => {
    const { params } = r1SalesAnalysis({});
    expect(params).toEqual([]);
  });
});

describe('r2PrimaryBifurcation', () => {
  it('splits sale, return, CN components', () => {
    const { text } = r2PrimaryBifurcation({});
    expect(text).toContain('sale_sales');
    expect(text).toContain('gri_sales');
    expect(text).toContain('rdsi_sales');
    expect(text).toContain('net_sales_');
  });
});

describe('r3ReturningExpiry', () => {
  it('uses gri_sales NOT return_amt', () => {
    const { text } = r3ReturningExpiry({});
    expect(text).toContain('gri_sales');
    expect(text).not.toContain('return_amt');
  });
  it('includes expiry buckets', () => {
    const { text } = r3ReturningExpiry({});
    expect(text).toContain('near_3');
    expect(text).toContain('near_6');
    expect(text).toContain('near_9');
    expect(text).toContain('expired');
  });
});

describe('r4StockistAnalysis', () => {
  it('groups by customer_n', () => {
    const { text } = r4StockistAnalysis({});
    expect(text).toContain('customer_n');
    expect(text).toContain('GROUP BY');
  });
  it('computes outstanding', () => {
    const { text } = r4StockistAnalysis({});
    expect(text).toContain('outstanding');
    expect(text).toContain('coll');
  });
});

describe('r5HqFyIncrDecr', () => {
  it('groups by hq_new and fy', () => {
    const { text } = r5HqFyIncrDecr({});
    expect(text).toContain('hq_new');
    expect(text).toContain('fy');
    expect(text).toContain('GROUP BY');
  });
  it('applies zbm filter when provided', () => {
    const { text, params } = r5HqFyIncrDecr({ zbm: 'ZBM MP' });
    expect(text).toContain('zbm = $1');
    expect(text).not.toContain(`'ZBM MP'`);
    expect(params).toEqual(['ZBM MP']);
  });
});
