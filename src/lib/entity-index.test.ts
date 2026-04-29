import { ENTITY_KIND_BY_COLUMN, isEntityColumn } from './entity-index';

describe('entity-index column→kind mapping', () => {
  it('maps known columns', () => {
    expect(ENTITY_KIND_BY_COLUMN.item_name).toBe('brand');
    expect(ENTITY_KIND_BY_COLUMN.hq_new).toBe('hq');
    expect(ENTITY_KIND_BY_COLUMN.dr_name).toBe('doctor');
    expect(ENTITY_KIND_BY_COLUMN.seg).toBe('segment');
    expect(ENTITY_KIND_BY_COLUMN.zbm).toBe('zbm');
  });

  it('isEntityColumn returns true only for mapped columns', () => {
    expect(isEntityColumn('item_name')).toBe(true);
    expect(isEntityColumn('hq')).toBe(false);            // legacy column, not mapped
    expect(isEntityColumn('net_sales_')).toBe(false);
    expect(isEntityColumn('does_not_exist')).toBe(false);
  });
});
