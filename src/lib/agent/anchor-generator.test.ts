import { extractAliases, generateAnchorQuestion } from './anchor-generator';

describe('extractAliases', () => {
  it('pulls AS-aliased columns from a SELECT', () => {
    const sql = `SELECT zbm, abm, hq_new,
      SUM(sale_sales) AS primary_sale,
      SUM(gri_sales) AS primary_return,
      SUM(net_sales_) AS net_primary
    FROM data WHERE fy = $1 GROUP BY zbm, abm, hq_new`;
    const aliases = extractAliases(sql);
    expect(aliases).toEqual(['primary_sale', 'primary_return', 'net_primary']);
  });

  it('returns empty array on no aliases', () => {
    expect(extractAliases('SELECT 1 FROM data')).toEqual([]);
  });
});

describe('generateAnchorQuestion', () => {
  it('produces a long-form NL question from name + sql', () => {
    const sql = `SELECT zbm, abm, hq_new,
      SUM(sale_sales) AS primary_sale,
      SUM(net_sales_) AS net_primary
    FROM data GROUP BY zbm, abm, hq_new ORDER BY net_primary DESC`;
    const q = generateAnchorQuestion('Sales Analysis', sql);
    expect(q).toMatch(/sales analysis/i);
    expect(q).toMatch(/primary[_ ]sale/i);
    expect(q).toMatch(/net[_ ]primary/i);
    expect(q).toMatch(/zbm/i);
    expect(q.length).toBeGreaterThan(50);
  });

  it('handles SQL with no GROUP BY', () => {
    const sql = `SELECT SUM(net_sales_) AS net_primary FROM data`;
    const q = generateAnchorQuestion('Total Sales', sql);
    expect(q).toMatch(/total sales/i);
    expect(q).toMatch(/net[_ ]primary/i);
  });
});
