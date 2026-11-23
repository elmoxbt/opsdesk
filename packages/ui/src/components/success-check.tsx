"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/utils";

/**
 * "Done!" moment (job completed, invoice paid, booking confirmed): the circle
 * scales in and the tick draws itself. Reduced motion: a plain fade.
 * Decorative; pair it with visible text that says what happened.
 */
export function SuccessCheck({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      viewBox="0 0 64 64"
      className={cn("size-16 text-status-completed", className)}
      aria-hidden
      initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
      animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
    >
      <circle cx="32" cy="32" r="30" fill="currentColor" opacity="0.14" />
      <circle cx="32" cy="32" r="22" fill="currentColor" />
      <motion.path
        d="M22 33 L29 40 L43 25"
        fill="none"
        stroke="white"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: reduce ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      />
    </motion.svg>
  );
}
