import { useEffect, useRef, useState } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import "./StatCard.css";

export type StatAccent = "blue" | "green" | "purple" | "amber" | "cyan" | "red";

interface StatCardProps {
  icon: PhosphorIcon;
  accent: StatAccent;
  number: number;
  label: string;
  onClick?: () => void;
  title?: string;
  /**
   * Optional last-N per-bucket counts (e.g. last 7 days) used to render a
   * tiny trend sparkline in the bottom-right corner of the card. Populated
   * from `DashboardStats.byDay` in `src/lib/workspace-data.ts`.
   */
  sparklinePoints?: number[];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
  );
}

/**
 * Mechanical count-up for the oversized stat numerals — the signature Overcode
 * motion. Not a smooth ease: the value ratchets through a fixed number of
 * discrete ticks (split-flap / terminal-counter feel, no soft deceleration).
 * Plays from 0 the first time the card appears, and re-ratchets from the last
 * value on refresh. Honors reduced motion (jumps straight to the value).
 */
function useAnimatedNumber(
  target: number,
  { maxTicks = 22, tickMs = 26 }: { maxTicks?: number; tickMs?: number } = {},
): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const valueRef = useRef(value);
  const timerRef = useRef<number | null>(null);
  valueRef.current = value;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const delta = target - from;
    if (delta === 0) return;
    // One tick per unit for small deltas; capped for big numbers so 208
    // ratchets in ~22 discrete jumps, not 208.
    const ticks = Math.min(Math.abs(delta), maxTicks);
    let tick = 0;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      tick += 1;
      // Linear progression — mechanical, no easing.
      const next = tick >= ticks ? target : Math.round(from + (delta * tick) / ticks);
      setValue(next);
      if (tick >= ticks && timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, tickMs);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [target, maxTicks, tickMs]);

  return value;
}

export function StatCard({
  icon: Icon,
  accent,
  number,
  label,
  onClick,
  title,
  sparklinePoints,
}: StatCardProps) {
  const animated = useAnimatedNumber(number);
  const interactive = typeof onClick === "function";
  const className = [
    "stat-card",
    `stat-card-${accent}`,
    interactive ? "is-interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className="stat-card-stripe" aria-hidden="true" />
      <div className="stat-card-head">
        <span className="stat-card-icon-backplate" aria-hidden="true">
          <Icon size={16} weight="bold" />
        </span>
      </div>
      <div className="stat-number">{animated}</div>
      <div className="stat-label">{label}</div>
      {sparklinePoints && sparklinePoints.length >= 2 && (
        <StatSparkline points={sparklinePoints} />
      )}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        title={title ?? label}
      >
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

/**
 * Tiny 60×16 trend line drawn from the supplied counts. Stroke colour is
 * inherited via `currentColor` so the amber card (which inverts text to
 * paper) keeps the line visible against its filled background.
 */
function StatSparkline({ points }: { points: number[] }) {
  const width = 60;
  const height = 16;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const path = points
    .map((value, idx) => {
      const x = idx * stepX;
      // Invert Y so larger values sit higher visually.
      const y = height - ((value - min) / range) * height;
      return `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className="stat-card-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
