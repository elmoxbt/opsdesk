import type { Transition, Variants } from "motion/react";

/**
 * Motion tokens (mirror the CSS variables in globals.css).
 * Rules: micro-interactions 150–250ms, page/modal 300–400ms, ease-out or a
 * gentle, non-bouncy spring. Only transform + opacity are ever animated.
 */
export const duration = { fast: 0.15, base: 0.2, slow: 0.35 } as const;
export const easeOut = [0.22, 1, 0.36, 1] as const;

export const transitions = {
  micro: { duration: duration.base, ease: easeOut },
  page: { duration: duration.slow, ease: easeOut },
  /** Critically-damped-ish spring: settles quickly with no visible bounce. */
  spring: { type: "spring", stiffness: 420, damping: 38, mass: 0.9 },
} satisfies Record<string, Transition>;

/** Page transition: fade + 8px slide-up. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transitions.page },
};

/** List rows: 30ms stagger, capped so long lists don't take forever to appear. */
export const STAGGER_STEP = 0.03;
export const STAGGER_CAP = 10;
export const staggerDelay = (index: number): number => Math.min(index, STAGGER_CAP) * STAGGER_STEP;

export const modalVariants: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: transitions.page },
  exit: { opacity: 0, scale: 0.96, transition: { duration: duration.base, ease: easeOut } },
};

export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: duration.base } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};
