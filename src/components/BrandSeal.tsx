import "./BrandSeal.css";

interface BrandSealProps {
  /** Visual size in pixels (default 64). Width = height. */
  size?: number;
  /** Optional aria label; defaults to a sensible string. */
  label?: string;
  className?: string;
}

/**
 * BrandSeal — a small 8×8 dot-matrix rendering of a `</>` mark
 * intended for empty states ("no repos yet", "no PRs", etc.).
 * Pure CSS grid; colored via design tokens so it adapts to themes.
 *
 * Not wired anywhere by default — sibling agents opt in by importing
 * and dropping it into their empty states.
 */
export function BrandSeal({ size = 64, label = "Overcode", className }: BrandSealProps) {
  return (
    <span
      className={["brand-seal", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
    >
      {/* 8×8 = 64 cells. Filled cells form a stylized </> glyph. */}
      {DOT_MAP.map((on, i) => (
        <span
          key={i}
          className={on ? "brand-seal-dot brand-seal-dot-on" : "brand-seal-dot"}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

// 8x8 bitmap — 1 = filled, 0 = empty. Forms a brutalist </> mark.
// Reading top-to-bottom, left-to-right.
const DOT_MAP: number[] = [
  0, 0, 1, 0, 0, 1, 0, 0,
  0, 1, 0, 0, 0, 0, 1, 0,
  1, 0, 0, 0, 0, 0, 0, 1,
  1, 0, 0, 1, 1, 0, 0, 1,
  1, 0, 0, 1, 1, 0, 0, 1,
  1, 0, 0, 0, 0, 0, 0, 1,
  0, 1, 0, 0, 0, 0, 1, 0,
  0, 0, 1, 0, 0, 1, 0, 0,
];
