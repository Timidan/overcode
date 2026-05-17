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

function useAnimatedNumber(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (prefersReduced) {
      setValue(target);
      return;
    }
    fromRef.current = value;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    function tick(now: number) {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const delta = target - fromRef.current;
      setValue(Math.round(fromRef.current + delta * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

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
