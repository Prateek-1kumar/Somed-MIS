'use client';
import { useEffect, useRef, useState } from 'react';

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
 *
 * Implementation note: `hasFetched` is a ref (not state) — we don't want it
 * to trigger re-renders, just to remember whether the next fetch is a first
 * load or a refetch. Calling setState from inside another setState's updater
 * function (the previous version of this hook) is undefined behaviour in
 * React 19; this version reads the ref synchronously instead.
 */
export function useDataFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): DataFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isFirstLoad, setFirstLoad] = useState(true);
  const [isRefetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // We set loading state synchronously when deps change. The "set-state-in-effect"
    // rule warns about this, but here it's load-bearing: the next render must
    // see isFirstLoad/isRefetching=true so the consumer flips to skeleton or
    // dim before the fetch resolves. There's no way to derive this from render.
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    if (hasFetched.current) {
      setRefetching(true);
    } else {
      setFirstLoad(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    fetcher()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => {
        if (cancelled) return;
        hasFetched.current = true;
        setFirstLoad(false);
        setRefetching(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, isFirstLoad, isRefetching, error };
}
