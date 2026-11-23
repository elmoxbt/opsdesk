"use client";

import { useClientConfig } from "./client-config";

/** Tab title for client-rendered pages, suffixed with THIS client's app name (React 19 hoists <title>). */
export function PageTitle({ children }: { children: string }) {
  const { appName } = useClientConfig();
  return <title>{`${children} · ${appName}`}</title>;
}
