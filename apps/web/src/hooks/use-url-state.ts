"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Filters, search and page live in the URL: views are shareable, survive
 * refresh, and the back button undoes a filter change.
 * Pass `keys` as a module-level constant so its identity is stable.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo(() => {
    const out = {} as Record<K, string | undefined>;
    for (const k of keys) out[k] = params.get(k) ?? undefined;
    return out;
  }, [params, keys]);

  const set = useCallback(
    (patch: Partial<Record<K, string | undefined>>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as Array<[string, string | undefined]>) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (opts.resetPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  return [state, set] as const;
}
