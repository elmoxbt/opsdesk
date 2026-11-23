"use client";

import { animate, useInView, useMotionValue, useReducedMotion, useTransform, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "../lib/utils";

interface CountUpProps {
  value: number;
  /** Intl formatting, e.g. { style: "currency", currency: "NGN" }. */
  format?: Intl.NumberFormatOptions;
  locale?: string;
  className?: string;
}

/** KPI number that counts up from 0 once it scrolls into view. Static under reduced motion. */
export function CountUp({ value, format, locale = "en-NG", className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const formatter = useMemo(() => new Intl.NumberFormat(locale, format), [locale, format]);
  // Let Intl do all rounding: pre-rounding would break percents (0.38 → 0 → "0%").
  const text = useTransform(mv, (v) => formatter.format(v));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [inView, reduce, value, mv]);

  return (
    <motion.span
      ref={ref}
      className={cn("font-mono tabular-nums", className)}
      aria-label={formatter.format(value)}
    >
      {text}
    </motion.span>
  );
}
