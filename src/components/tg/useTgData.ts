"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { cached, cacheFailed, cacheVersion, isFresh, refresh, subscribeCache } from "./cache";
import { useTg } from "./TgShell";

/** `key` is the address of one of the Mini App's own data routes; null asks for nothing. */
export function useTgData<T>(key: string | null): { data: T | undefined; failed: boolean; reload: () => Promise<void> } {
  const { api } = useTg();
  useSyncExternalStore(subscribeCache, cacheVersion, () => 0);
  const reload = useCallback(() => (key ? refresh(api, key) : Promise.resolve()), [api, key]);
  useEffect(() => {
    if (key && !isFresh(key)) refresh(api, key);
  }, [api, key]);
  return { data: key ? cached<T>(key) : undefined, failed: !!key && cacheFailed(key), reload };
}

