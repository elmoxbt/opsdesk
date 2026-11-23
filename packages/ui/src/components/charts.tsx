"use client";

import { motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { cn } from "../lib/utils";

/**
 * Small, dependency-free SVG charts for the analytics page.
 *
 * Rules they follow (dataviz method): one y-axis per chart, thin marks
 * (2px lines, bars ≤24px with 4px rounded data-ends), recessive grid, colour
 * from validated chart tokens (never the tenant brand), text in text colours,
 * a hover/focus tooltip on every mark, and a table view for every chart.
 * Animations draw in once, using only transform/opacity/path length, and are
 * skipped with reduced motion.
 */

export interface Point {
  key: string;
  /** Axis/tooltip label for the x position (e.g. "18 Nov"). */
  label: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Frame: title, optional summary, chart, and a table view
// ---------------------------------------------------------------------------

export function ChartFrame({
  title,
  summary,
  children,
  table,
  className,
}: {
  title: string;
  /** One line under the title: the headline the chart supports. */
  summary?: ReactNode;
  children: ReactNode;
  /** Rows for the table view: [label, formatted value][] with column headers. */
  table: { columns: [string, string]; rows: Array<[string, string]> };
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card p-5", className)} aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((t) => !t)}
          aria-pressed={asTable}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{table.columns[0]}</th>
                <th className="pb-2 text-right font-medium">{table.columns[1]}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map(([k, v], i) => (
                <tr key={i} className="border-t">
                  <td className="py-1.5">{k}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Width of an element, kept current. A callback ref (not useRef + mount effect):
 * the observer starts whenever the element actually attaches, including after
 * Suspense/hydration, where a one-shot mount effect can run before the node exists.
 */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, T | null, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    setW(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, el, w];
}

/** "Nice" axis maximum and 4 ticks (0, ¼, ½, ¾, max) so gridlines land on round numbers. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

function Tooltip({
  x,
  y,
  width,
  title,
  value,
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  value: string;
}) {
  const left = Math.min(Math.max(x, 60), width - 60);
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
      style={{ left, top: y - 8 }}
    >
      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-muted-foreground">{title}</p>
    </div>
  );
}

/** Arrow keys walk the points: the same readout on keyboard as on hover. */
function useKeyboardIndex(count: number, setIndex: (f: (i: number | null) => number | null) => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setIndex((i) => Math.min(count - 1, Math.max(0, (i ?? (d > 0 ? -1 : count)) + d)));
    } else if (e.key === "Escape") setIndex(() => null);
  };
}

const AXIS = "fill-muted-foreground text-[11px]";

/** First/last x labels hug the plot edges instead of hanging off them. */
const edgeAnchor = (i: number, count: number) =>
  count > 1 && i === 0 ? "start" : count > 1 && i === count - 1 ? "end" : "middle";

/** Every Nth label, plus the last one, never two crowding each other at the end. */
const showLabel = (i: number, count: number, every: number) =>
  i === count - 1 || (i % every === 0 && count - 1 - i >= every);

// ---------------------------------------------------------------------------
// Line + area (single series over time), with a crosshair
// ---------------------------------------------------------------------------

export function AreaChart({
  points,
  format,
  formatAxis = format,
  height = 220,
  label,
}: {
  points: Point[];
  format: (v: number) => string;
  formatAxis?: (v: number) => string;
  height?: number;
  /** Accessible name, e.g. "Revenue per day". */
  label: string;
}) {
  const [ref, node, width] = useWidth<HTMLDivElement>();
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId();
  const pad = { top: 12, right: 12, bottom: 24, left: 56 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const x = (i: number) => pad.left + (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.top + h - (v / max) * h;

  const { line, area } = useMemo(() => {
    if (!points.length || !width) return { line: "", area: "" };
    const l = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
    return { line: l, area: `${l}L${x(points.length - 1)},${pad.top + h}L${x(0)},${pad.top + h}Z` };
  }, [points, width, max]);

  const onKey = useKeyboardIndex(points.length, setActive);
  const nearest = (clientX: number) => {
    const r = node!.getBoundingClientRect();
    const rel = clientX - r.left - pad.left;
    return Math.round(Math.min(1, Math.max(0, rel / (w || 1))) * (points.length - 1));
  };
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(w / 72))));

  return (
    <div
      ref={ref}
      className="relative touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Use the arrow keys to read each point.`}
      onKeyDown={onKey}
      onPointerMove={(e) => points.length && setActive(nearest(e.clientX))}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      style={{ height }}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(max * t)}
                y2={y(max * t)}
                stroke="var(--chart-grid)"
              />
              <text x={pad.left - 8} y={y(max * t)} dy="0.32em" textAnchor="end" className={AXIS}>
                {formatAxis(max * t)}
              </text>
            </g>
          ))}
          {points.map(
            (p, i) =>
              showLabel(i, points.length, labelEvery) && (
                <text
                  key={p.key}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={edgeAnchor(i, points.length)}
                  className={AXIS}
                >
                  {p.label}
                </text>
              ),
          )}
          <motion.path
            d={area}
            fill={`url(#${gradient})`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
          {active !== null && points[active] && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={pad.top}
                y2={pad.top + h}
                stroke="var(--chart-axis)"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(active)}
                cy={y(points[active].value)}
                r={5}
                fill="var(--chart-1)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
      {active !== null && points[active] && (
        <Tooltip
          x={x(active)}
          y={y(points[active].value)}
          width={width}
          title={points[active].label}
          value={format(points[active].value)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns (single series, discrete buckets)
// ---------------------------------------------------------------------------

export function ColumnChart({
  points,
  format,
  height = 180,
  label,
}: {
  points: Point[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, , width] = useWidth<HTMLDivElement>();
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 24, left: 32 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const band = points.length ? w / points.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2)); // cap at 24px; at least a 2px gap
  const y = (v: number) => pad.top + h - (v / max) * h;
  const onKey = useKeyboardIndex(points.length, setActive);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(w / 56))));
  const baseline = pad.top + h;

  return (
    <div
      ref={ref}
      className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Use the arrow keys to read each column.`}
      onKeyDown={onKey}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      style={{ height }}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(max * t)}
                y2={y(max * t)}
                stroke="var(--chart-grid)"
              />
              <text x={pad.left - 6} y={y(max * t)} dy="0.32em" textAnchor="end" className={AXIS}>
                {Number.isInteger(max * t) ? max * t : ""}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = pad.left + band * i + band / 2;
            const top = y(p.value);
            const bh = baseline - top;
            const r = Math.min(4, bh, barW / 2);
            // Rounded data-end, square at the baseline.
            const d =
              bh <= 0
                ? ""
                : `M${cx - barW / 2},${baseline}V${top + r}Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top}H${cx + barW / 2 - r}Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r}V${baseline}Z`;
            return (
              <g key={p.key} onPointerEnter={() => setActive(i)}>
                {/* Hit target: the whole band, taller than the mark. */}
                <rect x={pad.left + band * i} y={pad.top} width={band} height={h} fill="transparent" />
                <motion.path
                  d={d}
                  fill="var(--chart-1)"
                  opacity={active === null || active === i ? 1 : 0.55}
                  style={{ transformOrigin: `${cx}px ${baseline}px`, transformBox: "view-box" }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{
                    duration: 0.5,
                    delay: reduce ? 0 : Math.min(i * 0.02, 0.4),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
                {showLabel(i, points.length, labelEvery) && (
                  <text x={cx} y={height - 6} textAnchor={edgeAnchor(i, points.length)} className={AXIS}>
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && points[active] && (
        <Tooltip
          x={pad.left + band * active + band / 2}
          y={y(points[active].value)}
          width={width}
          title={points[active].label}
          value={format(points[active].value)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar list (ranking), direct-labelled
// ---------------------------------------------------------------------------

export function BarList({
  items,
  format,
  colors,
}: {
  items: Array<{ key: string; label: string; value: number; hint?: string }>;
  format: (v: number) => string;
  /** CSS colour per item (ordinal ramps); defaults to series 1. */
  colors?: string[];
}) {
  const reduce = useReducedMotion();
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={it.key} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate">
              {it.label}
              {it.hint && <span className="ml-1.5 text-xs text-muted-foreground">{it.hint}</span>}
            </span>
            <span className="shrink-0 font-mono tabular-nums">{format(it.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden>
            <motion.div
              className="h-2 rounded-full"
              style={{
                width: `${(it.value / max) * 100}%`,
                backgroundColor: colors?.[i] ?? "var(--chart-1)",
                transformOrigin: "left",
              }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, delay: reduce ? 0 : i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Tall segmented bar (parts of a whole) with a legend
// ---------------------------------------------------------------------------

export function SegmentedBar({
  parts,
}: {
  parts: Array<{ key: string; label: string; value: number; color: string }>;
}) {
  const reduce = useReducedMotion();
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      {total === 0 ? (
        <div className="h-7 rounded bg-muted" aria-hidden />
      ) : (
        <div className="flex h-7 gap-0.5" aria-hidden>
          {shown.map((p, i) => (
            <motion.div
              key={p.key}
              className="h-7 rounded"
              title={`${p.label}: ${p.value}`}
              style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color, transformOrigin: "left" }}
              initial={reduce ? false : { scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.08 }}
            />
          ))}
        </div>
      )}
      {/* Legend with values: identity is never colour alone. */}
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-mono tabular-nums">{p.value}</span>
            {total > 0 && (
              <span className="text-xs text-muted-foreground">({Math.round((p.value / total) * 100)}%)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thin meter (0–1), e.g. utilisation in a table row
// ---------------------------------------------------------------------------

export function Meter({ value, label }: { value: number; label: string }) {
  const reduce = useReducedMotion();
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className="h-2 w-24 rounded-full bg-muted">
        <motion.div
          className="h-2 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: "var(--chart-1)", transformOrigin: "left" }}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="w-10 text-right font-mono text-xs tabular-nums">{pct}%</span>
    </div>
  );
}
