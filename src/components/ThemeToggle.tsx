import type { MouseEvent } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "../store/useTheme";
import "./ThemeToggle.css";

export function ThemeToggle() {
  const theme = useTheme((state) => state.theme);
  const toggle = useTheme((state) => state.toggle);
  const isDark = theme === "dark";

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Keyboard activation dispatches click with detail=0. Keep that path
    // immediate; only a real pointer click gets the circular reveal origin.
    if (event.detail === 0) {
      toggle();
      return;
    }
    // Compute the click origin from the button's screen rect so the
    // View Transitions circular reveal can grow from the toggle itself.
    // Falls back to the event coords when available.
    const rect = event.currentTarget.getBoundingClientRect();
    const x =
      event.clientX && event.clientX > 0
        ? event.clientX
        : rect.left + rect.width / 2;
    const y =
      event.clientY && event.clientY > 0
        ? event.clientY
        : rect.top + rect.height / 2;
    toggle({ x, y });
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      data-theme={theme}
      onClick={handleClick}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        <Sun size={18} weight="bold" className="theme-toggle-sun" />
        <Moon size={18} weight="fill" className="theme-toggle-moon" />
      </span>
    </button>
  );
}
