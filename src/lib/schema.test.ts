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
  it('builds parameterized WHERE for a single filter', () => {
    const { where, params } = parseFilters({ fy: '2025-2026' });
    expect(where).toBe('WHERE fy = $1');
    expect(params).toEqual(['2025-2026']);
  });

  it('combines multiple filters with AND and increments placeholders', () => {
    const { where, params } = parseFilters({ fy: '2025-2026', zbm: 'ZBM MP' });
    expect(where).toBe('WHERE fy = $1 AND zbm = $2');
    expect(params).toEqual(['2025-2026', 'ZBM MP']);
  });

  it('returns empty where + empty params when no filters', () => {
    const { where, params } = parseFilters({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('does not interpolate filter values into the SQL string', () => {
    // Injection guard: a bobby-tables value must never appear in the SQL.
    const evil = `'; DROP TABLE data; --`;
    const { where, params } = parseFilters({ fy: evil });
    expect(where).not.toContain(evil);
    expect(where).toBe('WHERE fy = $1');
    expect(params).toEqual([evil]);
  });
});
