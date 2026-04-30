'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CodeBlock({ code }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative group">
      <pre className="font-mono text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded-lg p-3 overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={onCopy}
        className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy SQL'}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-[var(--accent)]" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
