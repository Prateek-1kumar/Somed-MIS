'use client';
import React from 'react';
import { Brain, Wrench, CornerDownRight, ChevronDown, ChevronRight } from 'lucide-react';
import type { TraceEntry } from '@/lib/chatStorage';

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

interface Props {
  entries: TraceEntry[];
  /** When true, show the "thinking…" animation at the bottom. */
  live?: boolean;
  /** Default expanded. Parent can flip this post-final. */
  defaultExpanded?: boolean;
}

export default function StreamingTrace({ entries, live = false, defaultExpanded = true }: Props) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  if (entries.length === 0 && !live) return null;

  return (
    <div className="bg-[var(--bg-surface-raised)] border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <span className="font-semibold uppercase tracking-wider">
          {live ? 'Reasoning (live)' : `Reasoning · ${entries.length} step${entries.length === 1 ? '' : 's'}`}
        </span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {entries.map((e, i) => {
            if (e.kind === 'thinking') {
              return (
                <div key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--text-secondary)]">
                  <Brain className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <span>{e.text}</span>
                </div>
              );
            }
            if (e.kind === 'tool_call') {
              return (
                <div key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--text-secondary)]">
                  <Wrench className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)]">{e.tool}</span>
                  {e.args !== undefined && e.args !== null ? (
                    <span className="font-mono text-[var(--text-muted)]">
                      ({truncate(JSON.stringify(e.args), 100)})
                    </span>
                  ) : null}
                </div>
              );
            }
            // tool_result
            const r = e.result as { rowCount?: number; rows?: unknown[]; values?: unknown[]; error?: string };
            let summary = 'done';
            if (r?.error) summary = `error: ${r.error}`;
            else if (typeof r?.rowCount === 'number') summary = `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}`;
            else if (Array.isArray(r?.values)) summary = `${r.values.length} value${r.values.length === 1 ? '' : 's'}`;
            return (
              <div key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--text-muted)] pl-4">
                <CornerDownRight className="w-3 h-3 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <span className="font-mono">{summary}</span>
              </div>
            );
          })}

          {live && (
            <div className="flex items-center gap-1 pt-1 text-[12px] text-[var(--text-muted)]">
              <span>thinking</span>
              <span className="flex gap-0.5">
                <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
