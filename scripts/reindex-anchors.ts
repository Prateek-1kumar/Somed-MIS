// Reindex the report_anchors table from the canonical ReportDefs in
// src/reports/group-{a..g}.ts plus the 8 dashboard query functions in
// src/reports/dashboard.ts.
//
// Idempotent: SHA-diffs the search_text against existing rows and only
// re-embeds entries whose text changed. Text-only columns (name, anchor
// question, etc.) are still UPSERTed for unchanged rows so renames in
// source propagate without re-embedding.
//
// JSDoc anchor override: a function preceded by `/** @anchor <text> */`
// uses <text> as the anchor question instead of the auto-generated one.
//
// Usage:
//   npm run reindex-anchors

import { config as loadDotenv } from 'dotenv';
// Load .env.local first (Next-style local overrides), then .env as a fallback.
// `dotenv/config` only reads `.env`, so we wire this up explicitly.
loadDotenv({ path: '.env.local' });
loadDotenv();

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

import { Filters, ReportQuery } from '../src/lib/schema';
import { REPORTS } from '../src/reports';
import {
  dashOverviewKpis,
  dashOverviewFy,
  dashBrand,
  dashSegment,
  dashExpenses,
  dashPrimaryBifurcation,
  dashPrimaryBifurcationFy,
  dashReturning,
} from '../src/reports/dashboard';
import {
  extractAliases,
  generateAnchorQuestion,
} from '../src/lib/agent/anchor-generator';
import { embedTexts, sha256, toVectorLiteral } from '../src/lib/embeddings';

interface AnchorEntry {
  reportId: string;
  name: string;
  groupName: string;
  anchorQuestion: string;
  sourceSql: string;
  searchText: string;
  sha: string;
  fnName: string;
  sourceFile: string;
}

interface DashboardEntry {
  reportId: string;
  name: string;
  groupName: string;
  fnName: string;
  factory: (filters: Filters) => ReportQuery;
}

const DASHBOARD_ENTRIES: DashboardEntry[] = [
  { reportId: 'dash_overview_kpis',           name: 'Dashboard Overview KPIs',           groupName: 'Dashboard', fnName: 'dashOverviewKpis',           factory: dashOverviewKpis },
  { reportId: 'dash_overview_fy',             name: 'Dashboard Overview FY',             groupName: 'Dashboard', fnName: 'dashOverviewFy',             factory: dashOverviewFy },
  { reportId: 'dash_brand',                   name: 'Dashboard Brand',                   groupName: 'Dashboard', fnName: 'dashBrand',                   factory: dashBrand },
  { reportId: 'dash_segment',                 name: 'Dashboard Segment',                 groupName: 'Dashboard', fnName: 'dashSegment',                 factory: dashSegment },
  { reportId: 'dash_expenses',                name: 'Dashboard Expenses',                groupName: 'Dashboard', fnName: 'dashExpenses',                factory: dashExpenses },
  { reportId: 'dash_primary_bifurcation',     name: 'Dashboard Primary Bifurcation',     groupName: 'Dashboard', fnName: 'dashPrimaryBifurcation',     factory: dashPrimaryBifurcation },
  { reportId: 'dash_primary_bifurcation_fy',  name: 'Dashboard Primary Bifurcation FY',  groupName: 'Dashboard', fnName: 'dashPrimaryBifurcationFy',  factory: dashPrimaryBifurcationFy },
  { reportId: 'dash_returning',               name: 'Dashboard Returning',               groupName: 'Dashboard', fnName: 'dashReturning',               factory: dashReturning },
];

const REPORT_FN_NAMES: Record<string, string> = {
  r1:  'r1SalesAnalysis',
  r2:  'r2PrimaryBifurcation',
  r3:  'r3ReturningExpiry',
  r4:  'r4StockistAnalysis',
  r5:  'r5HqFyIncrDecr',
  r6:  'r6ItemWise',
  r7:  'r7ItemHqPerformance',
  r8:  'r8ItemFyIncrDecr',
  r9:  'r9ItemMonthly',
  r10: 'r10ItemReturn',
  r11: 'r11SegmentAnalysis',
  r12: 'r12SegmentReturns',
  r13: 'r13HqAnalysis',
  r14: 'r14HqItemPerformance',
  r15: 'r15HqItemFyIncrDecr',
  r16: 'r16HqMonthly',
  r17: 'r17HqQuarterly',
  r18: 'r18HqFyWise',
  r19: 'r19StockItemWise',
  r20: 'r20StockHqWise',
  r21: 'r21PatientSummary',
  r22: 'r22HqExpenses',
  r23: 'r23Dcpp',
  r24: 'r24DoctorVisitHierarchy',
  r25: 'r25JointWorkDetails',
  r26: 'r26HqMonthlyComparison',
  r27: 'r27ItemMonthlyComparison',
};

// 27 ReportDefs are spread across group-a..g. Build a map fnName → file path.
const REPORT_FN_FILES: Record<string, string> = {
  r1: 'group-a', r2: 'group-a', r3: 'group-a', r4: 'group-a', r5: 'group-a',
  r6: 'group-b', r7: 'group-b', r8: 'group-b', r9: 'group-b', r10: 'group-b',
  r11: 'group-c', r12: 'group-c',
  r13: 'group-d', r14: 'group-d', r15: 'group-d', r16: 'group-d', r17: 'group-d', r18: 'group-d',
  r19: 'group-e', r20: 'group-e',
  r21: 'group-f', r22: 'group-f', r23: 'group-f',
  r24: 'group-g', r25: 'group-g', r26: 'group-g', r27: 'group-g',
};

const sourceFileCache = new Map<string, string>();
function readSourceFile(relPath: string): string {
  if (sourceFileCache.has(relPath)) return sourceFileCache.get(relPath)!;
  const abs = resolve(process.cwd(), relPath);
  const txt = readFileSync(abs, 'utf8');
  sourceFileCache.set(relPath, txt);
  return txt;
}

/**
 * If the function definition is preceded by `/** @anchor ... *\/`, return that
 * override text. Otherwise return null.
 */
function findAnchorOverride(sourceText: string, fnName: string): string | null {
  // Escape fnName for use in regex (it's a JS identifier, but be safe).
  const safe = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    String.raw`@anchor\s+([^\n]+?)\s*\*\/\s*export\s+function\s+` + safe + String.raw`\b`,
  );
  const m = sourceText.match(re);
  if (!m) return null;
  return m[1].trim();
}

function buildEntries(): AnchorEntry[] {
  const entries: AnchorEntry[] = [];

  for (const def of REPORTS) {
    const sql = def.sqlFactory({}).text;
    const fnName = REPORT_FN_NAMES[def.id];
    const sourceRel = `src/reports/${REPORT_FN_FILES[def.id]}.ts`;
    const sourceText = readSourceFile(sourceRel);
    const override = fnName ? findAnchorOverride(sourceText, fnName) : null;
    const anchorQuestion = override ?? generateAnchorQuestion(def.name, sql);
    const aliases = extractAliases(sql);
    const searchText = `${anchorQuestion} ${def.name} ${aliases.join(' ')}`;
    entries.push({
      reportId: def.id,
      name: def.name,
      groupName: def.group,
      anchorQuestion,
      sourceSql: sql,
      searchText,
      sha: sha256(searchText),
      fnName: fnName ?? def.id,
      sourceFile: sourceRel,
    });
  }

  const dashboardSource = readSourceFile('src/reports/dashboard.ts');
  for (const d of DASHBOARD_ENTRIES) {
    const sql = d.factory({}).text;
    const override = findAnchorOverride(dashboardSource, d.fnName);
    const anchorQuestion = override ?? generateAnchorQuestion(d.name, sql);
    const aliases = extractAliases(sql);
    const searchText = `${anchorQuestion} ${d.name} ${aliases.join(' ')}`;
    entries.push({
      reportId: d.reportId,
      name: d.name,
      groupName: d.groupName,
      anchorQuestion,
      sourceSql: sql,
      searchText,
      sha: sha256(searchText),
      fnName: d.fnName,
      sourceFile: 'src/reports/dashboard.ts',
    });
  }

  return entries;
}

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Add it to .env.local.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    const entries = buildEntries();
    console.log(`Built ${entries.length} anchor entries from source.`);

    // Pull existing SHAs.
    const existingRows = await sql<{ report_id: string; embedding_sha: string | null }[]>`
      SELECT report_id, embedding_sha FROM report_anchors
    `;
    const existingShaByReportId = new Map<string, string | null>();
    for (const row of existingRows) {
      existingShaByReportId.set(row.report_id, row.embedding_sha);
    }

    const toEmbed: AnchorEntry[] = [];
    const textOnly: AnchorEntry[] = [];
    const unchanged: AnchorEntry[] = [];
    for (const e of entries) {
      const prev = existingShaByReportId.get(e.reportId);
      if (prev === undefined) {
        // New row.
        toEmbed.push(e);
      } else if (prev !== e.sha) {
        // Changed text → re-embed.
        toEmbed.push(e);
      } else {
        // Same SHA. We still need to UPSERT in case other text columns drifted,
        // but we don't need to recompute the embedding. We treat these as
        // "text-only" only if we want to actually push an UPSERT — for true
        // no-op idempotency, pure unchanged rows skip the write entirely.
        unchanged.push(e);
      }
    }

    // Embed the changed entries.
    let embeddings: number[][] = [];
    if (toEmbed.length > 0) {
      console.log(`Embedding ${toEmbed.length} entries via Gemini batch...`);
      embeddings = await embedTexts(toEmbed.map(e => e.searchText));
    }

    // UPSERT changed entries with new embeddings.
    for (let i = 0; i < toEmbed.length; i++) {
      const e = toEmbed[i];
      const vec = toVectorLiteral(embeddings[i]);
      await sql`
        INSERT INTO report_anchors (
          report_id, name, group_name, anchor_question,
          source_sql, search_text, embedding, embedding_sha
        ) VALUES (
          ${e.reportId}, ${e.name}, ${e.groupName}, ${e.anchorQuestion},
          ${e.sourceSql}, ${e.searchText},
          ${sql.unsafe(`'${vec}'::vector`)},
          ${e.sha}
        )
        ON CONFLICT (report_id) DO UPDATE SET
          name            = EXCLUDED.name,
          group_name      = EXCLUDED.group_name,
          anchor_question = EXCLUDED.anchor_question,
          source_sql      = EXCLUDED.source_sql,
          search_text     = EXCLUDED.search_text,
          embedding       = EXCLUDED.embedding,
          embedding_sha   = EXCLUDED.embedding_sha
      `;
    }

    // For unchanged rows, push text-only updates so renames / SQL drift in
    // source propagate even when search_text SHA matches by coincidence.
    // (In practice the SHA covers all the same text, so this is a no-op for
    // truly unchanged entries — but it's cheap insurance.)
    let textOnlyCount = 0;
    for (const e of unchanged) {
      const result = await sql`
        UPDATE report_anchors SET
          name            = ${e.name},
          group_name      = ${e.groupName},
          anchor_question = ${e.anchorQuestion},
          source_sql      = ${e.sourceSql},
          search_text     = ${e.searchText}
        WHERE report_id = ${e.reportId}
          AND (
               name            <> ${e.name}
            OR group_name      <> ${e.groupName}
            OR anchor_question <> ${e.anchorQuestion}
            OR source_sql      <> ${e.sourceSql}
            OR search_text     <> ${e.searchText}
          )
      `;
      if (result.count > 0) {
        textOnlyCount++;
        textOnly.push(e);
      }
    }

    const trulyUnchanged = unchanged.length - textOnlyCount;
    console.log(
      `${toEmbed.length} embedded, ${textOnlyCount} text-only updated, ${trulyUnchanged} unchanged`,
    );
  } finally {
    await sql.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
