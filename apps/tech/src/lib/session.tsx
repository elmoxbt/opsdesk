"use client";

import type { AuthUser } from "@opsdesk/shared";
import { createContext, useContext } from "react";

export const SessionContext = createContext<AuthUser | null>(null);
export function useSession(): AuthUser {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside the signed-in app");
  return s;
}
