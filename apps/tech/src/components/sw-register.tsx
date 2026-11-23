"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production builds only: in dev it would
 * cache hot-reloaded bundles and make every change look like it didn't apply.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(`/tech/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID}`, { scope: "/tech/" })
      .catch(() => undefined);
  }, []);
  return null;
}
