"use client";

import type { AuthUser } from "@opsdesk/shared";
import { createContext, useContext } from "react";

/** Provided by the app shell once /auth/me resolves; pages can assume a user. */
export const SessionContext = createContext<AuthUser | null>(null);

export function useSession(): AuthUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSession() must be used inside the authenticated app shell");
  return user;
}

export const canManage = (u: AuthUser): boolean => u.role === "OWNER" || u.role === "DISPATCHER";
