import type { ReactNode } from "react";
import { PageTransition } from "@opsdesk/ui/page-transition";

/** Re-mounts on every navigation inside the app, so each page fades + slides up 8px. */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
