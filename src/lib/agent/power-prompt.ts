// Loads power-prompt.md once per warm Lambda. Module-level cache keeps the
// disk read off the per-turn hot path. In dev, Next.js HMR re-evaluates this
// file when its imports change; the .md is read on each cold module init.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let _cache: string | null = null;

function load(): string {
  if (_cache !== null) return _cache;
  const path = join(process.cwd(), 'src/lib/agent/power-prompt.md');
  _cache = readFileSync(path, 'utf8');
  return _cache;
}

export const POWER_PROMPT: string = load();

/**
 * Returns the body of a top-level (#) section by name (case-insensitive),
 * or null if the section does not exist. Useful for tests and for any
 * runtime introspection of which behavioral rules are loaded.
 */
export function getPowerPromptSection(name: string): string | null {
  const re = new RegExp(`^#\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$([\\s\\S]*?)(?=^#\\s|\\Z)`, 'mi');
  const m = POWER_PROMPT.match(re);
  return m ? m[1].trim() : null;
}
