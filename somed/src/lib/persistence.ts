// src/lib/persistence.ts
import { openDB } from 'idb';

const DB_NAME = 'shomed-mis';
const DB_VERSION = 1;

function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('results')) {
        db.createObjectStore('results', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('chat')) {
        db.createObjectStore('chat', { keyPath: 'id', autoIncrement: true });
      }
    },
  });
}

export interface CachedResult {
  key: string;
  rows: Record<string, unknown>[];
  sql: string;
  filters: Record<string, string>;
  chartType: string;
  lastRun: string;
  dataVersion: number;
}

export async function saveResult(result: CachedResult): Promise<void> {
  const db = await getDb();
  await db.put('results', result);
}

export async function loadResult(key: string): Promise<CachedResult | undefined> {
  const db = await getDb();
  return db.get('results', key);
}

export async function markAllStale(newVersion: number): Promise<void> {
  const db = await getDb();
  const all = await db.getAll('results');
  const tx = db.transaction('results', 'readwrite');
  await Promise.all(all.map(r => tx.store.put({ ...r, dataVersion: -newVersion })));
  await tx.done;
}

export function getDataVersion(): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(localStorage.getItem('dataVersion') || '0', 10);
}

export function incrementDataVersion(): number {
  const next = getDataVersion() + 1;
  localStorage.setItem('dataVersion', String(next));
  return next;
}
