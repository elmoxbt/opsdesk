/** Only same-site relative paths are allowed after login (no open redirect via ?next=https://evil). */
export const safeNext = (next: string | null | undefined): string =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
