'use client';
import { useEffect, useState } from 'react';

export interface DataFetchState<T> {
  data: T | null;
  isFirstLoad: boolean;
  isRefetching: boolean;
  error: string | null;
}

/**
 * Skeleton-first, dim-on-refilter data fetch. First fetch gets `isFirstLoad`;
 * subsequent fetches (triggered by `deps` change) get `isRefetching` while
 * keeping the prior data visible so consumers can dim instead of blank.
 *
 * Pass `JSON.stringify(filters)` (or any stable string) as the dep so React
 * sees a primitive change and triggers the effect deterministically.
 */
export function useDataFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): DataFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isFirstLoad, setFirstLoad] = useState(true);
  const [isRefetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setData(prev => {
      // If we have prior data, this is a refetch — dim it.
      if (prev !== null) setRefetching(true); else setFirstLoad(true);
      return prev;
    });
    fetcher()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => {
        if (cancelled) return;
        setFirstLoad(false);
        setRefetching(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, isFirstLoad, isRefetching, error };
}
