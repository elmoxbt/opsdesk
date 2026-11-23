"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const COLORS = [
  "var(--primary)",
  "var(--status-completed)",
  "var(--status-scheduled)",
  "var(--status-en-route)",
];
const PIECES = 90;
const DURATION_MS = 2600;

interface Piece {
  left: number;
  delay: number;
  drift: number;
  spin: number;
  size: number;
  color: string;
  round: boolean;
}

/**
 * One-off celebration, reserved for a real milestone (the first invoice ever
 * paid). Pure DOM + CSS keyframes animating transform/opacity only, removed
 * after it plays, and never shown with reduced motion. `aria-hidden`: the toast
 * next to it carries the message.
 */
export function Confetti({ onDone }: { onDone?: () => void }) {
  const reduce = useReducedMotion();
  const [pieces] = useState<Piece[]>(() =>
    Array.from({ length: PIECES }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 400,
      drift: (Math.random() - 0.5) * 240,
      spin: (Math.random() - 0.5) * 1080,
      size: 6 + Math.random() * 6,
      color: COLORS[i % COLORS.length]!,
      round: i % 3 === 0,
    })),
  );

  useEffect(() => {
    if (reduce) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => onDone?.(), DURATION_MS + 500);
    return () => clearTimeout(t);
  }, [reduce, onDone]);

  if (reduce || typeof document === "undefined") return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      <style>{`@keyframes opsdesk-confetti{0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:1}85%{opacity:1}100%{transform:translate3d(var(--dx),105vh,0) rotate(var(--spin));opacity:0}}`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block will-change-transform"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? "9999px" : "2px",
              backgroundColor: p.color,
              "--dx": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
              animation: `opsdesk-confetti ${DURATION_MS}ms cubic-bezier(0.2,0.6,0.4,1) ${p.delay}ms both`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>,
    document.body,
  );
}
