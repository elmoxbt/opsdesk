"use client";

import type { Feature, PublicClientConfig } from "@opsdesk/config";
import { createContext, type ReactNode, useContext } from "react";

const ClientConfigContext = createContext<PublicClientConfig | null>(null);

/** Public white-label config, read on the server per request and handed to client components. */
export function ClientConfigProvider({
  value,
  children,
}: {
  value: PublicClientConfig;
  children: ReactNode;
}) {
  return <ClientConfigContext.Provider value={value}>{children}</ClientConfigContext.Provider>;
}

export function useClientConfig(): PublicClientConfig {
  const c = useContext(ClientConfigContext);
  if (!c) throw new Error("useClientConfig() outside ClientConfigProvider");
  return c;
}

export const useFeature = (feature: Feature): boolean => useClientConfig().features[feature];
