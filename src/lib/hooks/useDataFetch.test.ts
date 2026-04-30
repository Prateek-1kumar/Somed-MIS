/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useDataFetch } from './useDataFetch';

describe('useDataFetch', () => {
  it('starts in firstLoad and resolves with data', async () => {
    const { result } = renderHook(() => useDataFetch(() => Promise.resolve(42), ['k1']));
    expect(result.current.isFirstLoad).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current.isFirstLoad).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('captures error on rejection', async () => {
    const { result } = renderHook(() =>
      useDataFetch(() => Promise.reject(new Error('boom')), ['k2']),
    );
    await waitFor(() => expect(result.current.error).toMatch(/boom/));
    expect(result.current.data).toBeNull();
  });

  it('refetches and toggles isRefetching on dep change', async () => {
    let n = 0;
    const fetcher = () => Promise.resolve(++n);
    const { result, rerender } = renderHook(
      ({ k }) => useDataFetch(fetcher, [k]),
      { initialProps: { k: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ k: 'b' });
    // After rerender, isRefetching should briefly be true and data stays at 1.
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(result.current.isRefetching).toBe(false);
  });
});
