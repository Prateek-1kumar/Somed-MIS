'use client';
import ReactMarkdown from 'react-markdown';

const ALLOWED = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'br'] as const;

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED as unknown as string[]}
      unwrapDisallowed
      components={{
        p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        code: ({ children }) => (
          <code className="font-mono text-xs px-1 py-0.5 rounded bg-[var(--bg-surface-raised)]">
            {children}
          </code>
        ),
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
      }}
    >{children}</ReactMarkdown>
  );
}
