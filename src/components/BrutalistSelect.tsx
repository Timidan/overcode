import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import "./BrutalistSelect.css";

export interface BrutalistSelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

interface BrutalistSelectProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  options: BrutalistSelectOption<T>[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Brutalist replacement for `<select>` — keeps the app's design language
 * inside the popover. Native `<select>` can't be styled when open; this
 * uses a button + absolute-positioned popover sized to the trigger.
 *
 * - Click trigger → toggle popover
 * - Click option → select + close
 * - Click outside / Esc → close
 * - ↑/↓ to move highlight, Enter to select, Home/End to jump
 */
export function BrutalistSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  className,
  disabled,
}: BrutalistSelectProps<T>) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const id = useId();

  const current = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset highlight to the current selection when opening.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
  }, [open, options, value]);

  // Scroll highlighted option into view when navigating with the keyboard.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const child = listRef.current.children[highlight] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function pick(idx: number) {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!open) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(options.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(highlight);
    }
  }

  const className_ = ["bsel", className].filter(Boolean).join(" ");

  return (
    <div className={className_} ref={wrapRef}>
      <button
        type="button"
        className={`bsel-trigger${open ? " is-open" : ""}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        title={current?.label ?? placeholder}
      >
        <span className="bsel-value">
          {current ? current.label : placeholder}
        </span>
        <CaretDown size={12} className="bsel-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="bsel-list"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((opt, idx) => {
            const isActive = idx === highlight;
            const isSelected = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`bsel-option${isActive ? " is-active" : ""}${
                  isSelected ? " is-selected" : ""
                }`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  // mousedown so we beat the outside-click handler that
                  // listens for `mousedown` (would close before click).
                  e.preventDefault();
                  pick(idx);
                }}
                title={opt.hint ?? opt.label}
              >
                <span className="bsel-option-label">{opt.label}</span>
                {opt.hint && (
                  <span className="bsel-option-hint">{opt.hint}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
