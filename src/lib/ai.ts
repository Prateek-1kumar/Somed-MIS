// src/lib/ai.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { CSV_COLUMNS } from './schema';

const SCHEMA_HINT = `
Table name: data (single table, no joins needed)
Columns: ${CSV_COLUMNS.join(', ')}

KEY FORMULAS — use these exactly:
- Primary Sales       = SUM(net_sales_)
- Primary Target      = SUM(tgt_val_p)
- Primary Ach%        = ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)
- Secondary Sales     = SUM(sales_valu)
- Secondary Target    = SUM(tgt_val_s)
- Secondary Ach%      = ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)
- FOC Value           = SUM(foc_value)   ← NOT foc_value_, NOT foc_val_n
- FOC Qty             = SUM(foc_qty__s + cn_qty)
- Net Secondary       = SUM(sales_valu) - SUM(foc_val_n)
- Total Secondary     = SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)
- Total Expenses      = SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)
- Sale Primary        = SUM(sale_sales)
- Returning Primary   = SUM(gri_sales)   ← negative values
- RDSI Primary        = SUM(rdsi_sales)  ← negative values
- Net Primary         = SUM(net_sales_)
- Total Returning     = SUM(return_amt)  ← negative values
- Expired Returning   = SUM(expired)
- Near 3m expiry      = SUM(near_3)
- Near 6m expiry      = SUM(near_6)
- Near 9m expiry      = SUM(near_9)
- Long Expiry (>9m)   = SUM(return_amt)-SUM(expired)-SUM(near_3)-SUM(near_6)-SUM(near_9)
- PAP Patients        = SUM(no_patient) * 1000
- DCPP Patients       = SUM(dc_patient) * 1000
- Exclude inactive    = WHERE item_name NOT LIKE '(INACTIVE)%'

FY values: '2022-2023','2023-2024','2024-2025','2025-2026','2026-2027'
Segments (seg): ABX, GASTRO, GYNAE, NEURO, ORTHO, WELLNESS
ZBMs: 'RBM WEST', 'ZBM EAST', 'ZBM MP'
HQs (hq_new): AGRA, ALIGARH, BAREILLY, BIJNOR, CHANDAUSI, DEHRADUN, DEORIA, GHAZIABAD, GONDA, GORAKHPUR, HALDWANI, HARDA, JHANSI, MEERUT, MORADABAD
`.trim();

const NL_EXPLAIN_PROMPT = (question: string) => `
You are a data analyst for Shomed Remedies (pharma company). Generate a DuckDB SQL query to answer the user's question.

${SCHEMA_HINT}

Respond in EXACTLY this format — two parts separated by a blank line:
EXPLANATION: [1-3 sentences explaining in plain English what data you are fetching and which columns/formulas you are using]

SQL:
[valid DuckDB SQL — no markdown, no backticks, no semicolon at end]

If the question is ambiguous, respond with: CLARIFY: [one question to resolve ambiguity]

User question: ${question}
`.trim();

const PB_PROMPT = (sql: string) => `
Convert this PowerBI/MSSQL query to DuckDB SQL. Output ONLY the converted SQL, no explanation.
Rules: TOP n → LIMIT n, [bracket names] → plain names, ISNULL → COALESCE, [dbo].[anything] → data, GETDATE() → CURRENT_DATE, remove NOLOCK hints, remove WITH(NOLOCK).

${SCHEMA_HINT}

PowerBI SQL:
${sql}
`.trim();

const REFINE_PROMPT = (currentSql: string, instruction: string, reportTitle: string) => `
You are a DuckDB SQL editor for Shomed Remedies MIS.
Modify the query below according to the user's instruction.

${SCHEMA_HINT}

Respond in EXACTLY this format:
EXPLANATION: [1-2 sentences describing what you changed and why]

SQL:
[complete modified SQL — no markdown, no backticks]

If the instruction is ambiguous, respond with: CLARIFY: [one question]

Report: ${reportTitle}

Current SQL:
${currentSql}

User instruction: ${instruction}
`.trim();

async function callGemini(prompt: string): Promise<string> {
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function callGroq(prompt: string): Promise<string> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 768,
  });
  const content = completion.choices[0].message.content;
  if (!content) throw new Error('Groq returned no content');
  return content.trim();
}

function parseExplanationAndSql(response: string): { sql?: string; explanation?: string; clarify?: string } {
  if (response.startsWith('CLARIFY:')) {
    return { clarify: response.replace('CLARIFY:', '').trim() };
  }
  // Strip any accidental markdown fences
  const clean = response.replace(/^```(?:sql)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const explMatch = clean.match(/^EXPLANATION:\s*([\s\S]*?)\n[\s\r]*\nSQL:\s*\n([\s\S]+)$/i);
  if (explMatch) {
    return { explanation: explMatch[1].trim(), sql: explMatch[2].trim() };
  }
  // Fallback: no explanation, treat whole response as SQL
  return { sql: clean };
}

export async function generateSqlWithExplanation(question: string): Promise<{ sql?: string; explanation?: string; clarify?: string }> {
  const prompt = NL_EXPLAIN_PROMPT(question);
  let response: string;
  try {
    response = await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    response = await callGroq(prompt);
  }
  return parseExplanationAndSql(response);
}

// Keep original for backward compat with existing reports page
export async function generateSql(question: string): Promise<{ sql?: string; clarify?: string }> {
  const result = await generateSqlWithExplanation(question);
  return { sql: result.sql, clarify: result.clarify };
}

export async function refineSql(
  currentSql: string,
  instruction: string,
  reportTitle: string,
): Promise<{ sql?: string; explanation?: string; clarify?: string }> {
  const prompt = REFINE_PROMPT(currentSql, instruction, reportTitle);
  let response: string;
  try {
    response = await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    response = await callGroq(prompt);
  }
  return parseExplanationAndSql(response);
}

export async function convertPowerBiSql(sql: string): Promise<string> {
  const prompt = PB_PROMPT(sql);
  let response: string;
  try {
    response = await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    response = await callGroq(prompt);
  }
  return response.replace(/^```(?:sql)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}
