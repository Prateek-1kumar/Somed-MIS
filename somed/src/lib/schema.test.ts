import { validateCsvRow, CSV_COLUMNS, parseFilters } from '@/lib/schema';

describe('validateCsvRow', () => {
  const validRow = CSV_COLUMNS.reduce((acc: Record<string, string>, col) => ({ ...acc, [col]: '0' }), {});

  it('returns valid for a complete row', () => {
    expect(validateCsvRow(validRow).valid).toBe(true);
  });

  it('returns invalid when column is missing', () => {
    const row = { ...validRow } as Record<string, string>;
    delete row.hq_new;
    expect(validateCsvRow(row).valid).toBe(false);
    expect(validateCsvRow(row).missingColumns).toContain('hq_new');
  });

  it('flags blank hq_new as invalid', () => {
    const row = { ...validRow, hq_new: '' };
    expect(validateCsvRow(row).valid).toBe(false);
    expect(validateCsvRow(row).blankHqNew).toBe(true);
  });
});

describe('parseFilters', () => {
  it('builds WHERE clause for fy filter', () => {
    const result = parseFilters({ fy: '2025-2026' });
    expect(result).toBe(`WHERE fy = '2025-2026'`);
  });

  it('combines multiple filters with AND', () => {
    const result = parseFilters({ fy: '2025-2026', zbm: 'ZBM MP' });
    expect(result).toContain(`fy = '2025-2026'`);
    expect(result).toContain(`zbm = 'ZBM MP'`);
    expect(result).toContain('AND');
  });

  it('returns empty string when no filters', () => {
    expect(parseFilters({})).toBe('');
  });
});
