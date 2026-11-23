"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { pageVariants } from "../lib/motion";

/** Used from `template.tsx`, which re-mounts on every navigation, so each page fades/slides in. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate">
      {children}
    </motion.div>
  );
}
