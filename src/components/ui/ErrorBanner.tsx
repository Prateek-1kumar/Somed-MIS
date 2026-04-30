import { AlertCircle } from 'lucide-react';

export function ErrorBanner({
  error, onRetry,
}: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-semibold text-red-700 dark:text-red-300">Something went wrong</p>
        <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-sm font-medium underline text-red-700 dark:text-red-300 hover:opacity-80"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
