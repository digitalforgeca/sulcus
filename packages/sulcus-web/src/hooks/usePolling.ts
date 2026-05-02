'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UsePollingOptions<T> {
  fetcher: () => Promise<T>;
  interval?: number;      // ms, default 30000
  cooldown?: number;      // ms, default 10000
  enabled?: boolean;
}

interface UsePollingResult<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => void;
  cooldownRemaining: number; // seconds remaining in cooldown
}

export function usePolling<T>({
  fetcher,
  interval = 30_000,
  cooldown = 10_000,
  enabled = true,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const cooldownEnd = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const doFetch = useCallback(async (manual = false) => {
    if (manual && Date.now() < cooldownEnd.current) return;

    if (manual) {
      setIsRefreshing(true);
      cooldownEnd.current = Date.now() + cooldown;
      setCooldownRemaining(Math.ceil(cooldown / 1000));
      // tick down every second
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      cooldownTimer.current = setInterval(() => {
        const rem = Math.ceil((cooldownEnd.current - Date.now()) / 1000);
        if (rem <= 0) {
          setCooldownRemaining(0);
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
        } else {
          setCooldownRemaining(rem);
        }
      }, 1000);
    }

    try {
      const result = await fetcher();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fetcher, cooldown]);

  // Initial load + interval polling (only when tab is visible)
  useEffect(() => {
    if (!enabled) return;

    doFetch();

    const schedule = () => {
      timerRef.current = setTimeout(() => {
        if (document.visibilityState === 'visible') doFetch();
        schedule();
      }, interval);
    };
    schedule();

    const onVisible = () => {
      if (document.visibilityState === 'visible') doFetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [doFetch, interval, enabled]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return { data, isLoading, isRefreshing, error, lastUpdated, refresh, cooldownRemaining };
}
