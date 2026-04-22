// src/lib/ai.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { CSV_COLUMNS } from './schema';

const SCHEMA_HINT = `
Table name: data
Columns: ${CSV_COLUMNS.join(', ')}
Key computed metrics:
- Net Primary = net_sales_
- Achievement % = SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100
- Secondary Net = SUM(sales_valu) - SUM(foc_val_n)
- Use gri_sales for return value (not return_amt)
FY values: '2022-2023','2023-2024','2024-2025','2025-2026','2026-2027'
Segments: ABX,GASTRO,GYNAE,NEURO,ORTHO,WELLNESS
HQs (hq_new): AGRA,ALIGARH,BAREILLY,BIJNOR,CHANDAUSI,DEHRADUN,DEORIA,GHAZIABAD,GONDA,GORAKHPUR,HALDWANI,HARDA,JHANSI,MEERUT,MORADABAD
ZBMs: RBM WEST, ZBM EAST, ZBM MP
`.trim();

const NL_PROMPT = (question: string) => `
You are a SQL generator for DuckDB. Generate ONLY a valid DuckDB SQL query. No explanation, no markdown, no backticks.
If you are unsure how to map the question to columns, respond with: CLARIFY: <your question>

${SCHEMA_HINT}

User question: ${question}
`.trim();

const PB_PROMPT = (sql: string) => `
Convert this PowerBI/MSSQL query to DuckDB SQL. Output ONLY the converted SQL, no explanation.
Rules: TOP n → LIMIT n, [bracket names] → plain names, ISNULL → COALESCE, [dbo].[anything] → data, GETDATE() → CURRENT_DATE, remove NOLOCK hints, remove WITH(NOLOCK).

${SCHEMA_HINT}

PowerBI SQL:
${sql}
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
    max_tokens: 512,
  });
  return completion.choices[0].message.content?.trim() ?? '';
}

export async function generateSql(question: string): Promise<{ sql?: string; clarify?: string }> {
  const prompt = NL_PROMPT(question);
  let response: string;
  try {
    response = await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    response = await callGroq(prompt);
  }
  if (response.startsWith('CLARIFY:')) return { clarify: response.replace('CLARIFY:', '').trim() };
  return { sql: response };
}

export async function convertPowerBiSql(sql: string): Promise<string> {
  const prompt = PB_PROMPT(sql);
  try {
    return await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    return await callGroq(prompt);
  }
}
