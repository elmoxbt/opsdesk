import type { ReactNode } from "react";
import { PageTransition } from "@opsdesk/ui/page-transition";

export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
