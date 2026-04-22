'use client';
import { useState } from 'react';

interface Props {
  sql: string;
  onRun: (sql: string) => void;
  onReset?: () => void;
  onSave?: (sql: string) => void;
  powerBiMode?: boolean;
}

export default function SqlEditor({ sql, onRun, onReset, onSave, powerBiMode }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(sql);
  const [pbSql, setPbSql] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const convertPowerBi = async () => {
    setConverting(true);
    setConvertError(null);
    try {
      const res = await fetch('/api/powerbi-to-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: pbSql }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { convertedSql } = await res.json() as { convertedSql: string };
      setValue(convertedSql);
    } catch (e) {
      setConvertError(String(e));
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="mt-4 border border-zinc-200 rounded">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
        <span>SQL Editor</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2">
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-full font-mono text-xs border border-zinc-300 rounded p-2 h-40 resize-y"
          />
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => onRun(value)}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Run Modified</button>
            {onReset && <button onClick={() => { setValue(sql); onReset(); }}
              className="px-3 py-1 text-xs border border-zinc-300 rounded hover:bg-zinc-50">Reset</button>}
            {onSave && <button onClick={() => onSave(value)}
              className="px-3 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50">Save as Report</button>}
          </div>
          {powerBiMode && (
            <div className="pt-2 border-t border-zinc-200 space-y-2">
              <p className="text-xs text-zinc-500">Paste PowerBI SQL — AI converts to DuckDB SQL</p>
              <textarea
                value={pbSql}
                onChange={e => setPbSql(e.target.value)}
                placeholder="Paste PowerBI SQL here…"
                className="w-full font-mono text-xs border border-zinc-300 rounded p-2 h-24 resize-y"
              />
              <button onClick={convertPowerBi} disabled={!pbSql || converting}
                className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                {converting ? 'Converting…' : 'Convert & Load'}
              </button>
              {convertError && <p className="text-xs text-red-600">{convertError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
