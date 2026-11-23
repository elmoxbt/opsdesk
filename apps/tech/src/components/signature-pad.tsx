"use client";

import { Button } from "@opsdesk/ui/button";
import { Eraser } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  /** PNG of the signature, or null if nothing was drawn. */
  toBlob(): Promise<Blob | null>;
}

/**
 * Finger/stylus/mouse signature on a canvas (Pointer Events, so one code path
 * for every input). Scaled for the device pixel ratio so strokes are crisp,
 * with quadratic smoothing between points. touch-action:none stops the page
 * scrolling while signing.
 */
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { label: string; onChange?: (hasInk: boolean) => void }
>(function SignaturePad({ label, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827"; // dark ink on the white pad in both themes
  }, []);

  useEffect(setup, [setup]);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = point(e);
    const ctx = canvas.current!.getContext("2d")!;
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  };
  const up = () => {
    last.current = null;
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange?.(false);
  };

  useImperativeHandle(ref, () => ({
    toBlob: () =>
      hasInk ? new Promise((resolve) => canvas.current!.toBlob(resolve, "image/png")) : Promise.resolve(null),
  }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" id="sig-label">
          {label}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
          <Eraser aria-hidden /> Clear
        </Button>
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-labelledby="sig-label"
        aria-describedby="sig-help"
        className="h-44 w-full touch-none rounded-xl border-2 border-dashed bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <p id="sig-help" className="text-xs text-muted-foreground">
        {hasInk ? "Signed. Clear to redo." : "Ask the customer to sign with a finger."}
      </p>
    </div>
  );
});
