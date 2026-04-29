import { COLUMN_DESCRIPTIONS } from './column-descriptions';
import { CSV_COLUMNS } from './schema';

describe('COLUMN_DESCRIPTIONS', () => {
  it('has an entry for every CSV_COLUMNS value', () => {
    for (const col of CSV_COLUMNS) {
      expect(COLUMN_DESCRIPTIONS[col]).toBeDefined();
      expect(COLUMN_DESCRIPTIONS[col].length).toBeGreaterThan(20);
    }
  });

  it('has no extra keys beyond CSV_COLUMNS', () => {
    const csv = new Set<string>(CSV_COLUMNS);
    for (const k of Object.keys(COLUMN_DESCRIPTIONS)) {
      expect(csv.has(k)).toBe(true);
    }
  });

  it('mentions the trailing-underscore distinction for net_sales_', () => {
    expect(COLUMN_DESCRIPTIONS.net_sales_).toMatch(/underscore/i);
    expect(COLUMN_DESCRIPTIONS.net_sales_).toMatch(/net_sales/);
  });

  it('mentions sign convention for gri_sales and rdsi_sales', () => {
    expect(COLUMN_DESCRIPTIONS.gri_sales).toMatch(/negative/i);
    expect(COLUMN_DESCRIPTIONS.rdsi_sales).toMatch(/negative/i);
  });

  it('mentions FOC three-way distinction', () => {
    expect(COLUMN_DESCRIPTIONS.foc_value).toMatch(/canonical/i);
    expect(COLUMN_DESCRIPTIONS.foc_val_n).toMatch(/foc_val_n|adjustment/i);
  });

  it('mentions yyyymm is text not integer', () => {
    expect(COLUMN_DESCRIPTIONS.yyyymm).toMatch(/text/i);
    expect(COLUMN_DESCRIPTIONS.yyyymm).toMatch(/leading zeros/i);
  });
});
