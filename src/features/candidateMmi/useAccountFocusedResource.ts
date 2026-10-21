import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';

type AccountResource<T> = Readonly<{ accountId: string; value: T | null; failed: boolean }>;

/** A blurred screen or a different account must never publish an old request. */
export function useAccountFocusedResource<T>(accountId: string | null, load: () => PromiseLike<T>) {
  const [snapshot, setSnapshot] = useState<AccountResource<T> | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useFocusEffect(useCallback(() => {
    if (!accountId) return;
    let active = true;
    let requestVersion = 0;
    let midnightTimer: ReturnType<typeof setTimeout>;
    const reload = async () => {
      const version = ++requestVersion;
      setSnapshot({ accountId, value: null, failed: false });
      try {
        const value = await load();
        if (active && version === requestVersion) setSnapshot({ accountId, value, failed: false });
      } catch {
        if (active && version === requestVersion) setSnapshot({ accountId, value: null, failed: true });
      }
    };
    const scheduleMidnight = () => {
      clearTimeout(midnightTimer);
      const now = Date.now();
      const nextMidnight = (Math.floor(now / 86_400_000) + 1) * 86_400_000;
      midnightTimer = setTimeout(() => { void reload(); scheduleMidnight(); }, nextMidnight - now + 1_000);
    };
    const resume = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void reload();
      scheduleMidnight();
    };
    void reload();
    scheduleMidnight();
    const nativeState = typeof document === 'undefined' ? AppState.addEventListener('change', state => { if (state === 'active') resume(); }) : null;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resume);
    if (typeof window !== 'undefined') window.addEventListener('pageshow', resume);
    return () => {
      active = false;
      clearTimeout(midnightTimer);
      nativeState?.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume);
      if (typeof window !== 'undefined') window.removeEventListener('pageshow', resume);
    };
  }, [accountId, load, revision]));

  const current = snapshot?.accountId === accountId ? snapshot : null;
  return {
    value: current?.value ?? null,
    unavailable: current?.failed ?? false,
    refreshing: accountId !== null && (!current || (!current.failed && current.value === null)),
    refresh,
  };
}
