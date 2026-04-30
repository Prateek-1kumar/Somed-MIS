// Entity-index helper — refreshes the `entity_values` Postgres table from
// the canonical `data` rows. Called inside the CSV ingest transaction (so
// the index always matches the live data) and from the one-shot seed script
// `scripts/seed-entity-index.ts`.
//
// `entity_values` powers fuzzy lookup of brand/HQ/doctor/segment/ZBM names
// in chat: a user typing "crockin" gets matched to "CROCIN" via pg_trgm.

import type { Sql, TransactionSql } from 'postgres';
import type { CsvColumn } from './schema';

// Either the singleton client or a transaction handle from `sql.begin`.
type SqlOrTx = Sql | TransactionSql;

export type EntityKind = 'brand' | 'hq' | 'doctor' | 'segment' | 'zbm';

export const ENTITY_KIND_BY_COLUMN: Partial<Record<CsvColumn, EntityKind>> = {
  item_name: 'brand',
  hq_new:    'hq',
  dr_name:   'doctor',
  seg:       'segment',
  zbm:       'zbm',
};

export function isEntityColumn(col: string): boolean {
  return col in ENTITY_KIND_BY_COLUMN;
}

/**
 * Refresh all five entity kinds from the `data` table. Each kind is one
 * INSERT … ON CONFLICT DO UPDATE so subsequent runs simply update
 * `display_count` rather than duplicating.
 *
 * Accepts the singleton `sql` client OR a transaction handle (`tx` from
 * `sql.begin`). They share the same Sql type at runtime.
 */
export async function refreshEntityIndex(sql: SqlOrTx): Promise<void> {
  // 1. brand — first alphanumeric token of item_name, uppercased.
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'brand',
           UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*')),
           COUNT(*)
    FROM data
    WHERE item_name IS NOT NULL
      AND item_name NOT LIKE '(INACTIVE)%'
      AND substring(item_name from '^[A-Za-z][A-Za-z0-9]*') <> ''
    GROUP BY UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*'))
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;

  // 2. hq
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'hq', hq_new, COUNT(*)
    FROM data WHERE hq_new IS NOT NULL AND TRIM(hq_new) <> ''
    GROUP BY hq_new
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;

  // 3. doctor
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'doctor', dr_name, COUNT(*)
    FROM data WHERE dr_name IS NOT NULL AND TRIM(dr_name) <> ''
    GROUP BY dr_name
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;

  // 4. segment
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'segment', seg, COUNT(*)
    FROM data WHERE seg IS NOT NULL AND TRIM(seg) <> ''
    GROUP BY seg
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;

  // 5. zbm
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'zbm', zbm, COUNT(*)
    FROM data WHERE zbm IS NOT NULL AND TRIM(zbm) <> ''
    GROUP BY zbm
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;
}
