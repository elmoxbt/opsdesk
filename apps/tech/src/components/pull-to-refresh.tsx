"use client";

import { RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";

const TRIGGER = 72;
const MAX = 110;

/**
 * Pull down at the top of the list to refresh (and push queued changes).
 * Resistance makes the pull feel physical; past the threshold the icon turns
 * to say "let go". The page-level fallback is the regular refresh button.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = window.scrollY <= 0 && !refreshing ? e.touches[0]!.clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const dy = e.touches[0]!.clientY - start.current;
    setPull(dy > 0 ? Math.min(MAX, dy * 0.45) : 0);
  };
  const onTouchEnd = async () => {
    const shouldRefresh = pull >= TRIGGER;
    start.current = null;
    setPull(shouldRefresh ? TRIGGER : 0);
    if (!shouldRefresh) return;
    setRefreshing(true);
    navigator.vibrate?.(8);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={() => void onTouchEnd()}>
      <motion.div
        className="flex h-0 items-end justify-center overflow-visible"
        animate={{ opacity: pull > 8 || refreshing ? 1 : 0 }}
        aria-hidden={!refreshing}
      >
        <motion.span
          className="mb-2 grid size-9 place-items-center rounded-full border bg-card shadow-sm"
          style={{ y: reduce ? 0 : pull }}
          animate={refreshing ? { rotate: 360 } : { rotate: (pull / TRIGGER) * 220 }}
          transition={refreshing ? { repeat: Infinity, duration: 0.8, ease: "linear" } : { duration: 0 }}
        >
          <RefreshCw
            className={pull >= TRIGGER || refreshing ? "size-4 text-primary" : "size-4 text-muted-foreground"}
          />
        </motion.span>
      </motion.div>
      {refreshing && (
        <span className="sr-only" role="status">
          Refreshing
        </span>
      )}
      <motion.div style={{ y: reduce ? 0 : pull }}>{children}</motion.div>
    </div>
  );
}
