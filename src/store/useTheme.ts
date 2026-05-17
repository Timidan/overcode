import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "overcode.theme";

function readInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Set the data-theme attribute on <html>. The legacy
 *  `theme-transitioning` class is kept as a fallback for browsers
 *  that don't support the View Transitions API (Electron is Chromium
 *  so it should — this is defensive only). */
function applyThemeAttribute(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function applyThemeFallback(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  applyThemeAttribute(theme);
  void root.offsetHeight;
  window.setTimeout(() => {
    root.classList.remove("theme-transitioning");
  }, 60);
}

// Browser-supplied API; only present in Chromium 111+.
type StartViewTransition = (callback: () => void) => {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
};

function getStartViewTransition(): StartViewTransition | null {
  if (typeof document === "undefined") return null;
  const fn = (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition;
  return typeof fn === "function" ? fn.bind(document) : null;
}

interface ThemeState {
  theme: Theme;
  /** Set the theme, optionally with a click origin (x, y in viewport
   *  pixels) so the circular reveal animates from that point. */
  setTheme: (theme: Theme, origin?: { x: number; y: number }) => void;
  /** Toggle dark/light. ThemeToggle passes an origin in via setTheme. */
  toggle: (origin?: { x: number; y: number }) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readInitial(),
  setTheme: (theme, origin) => {
    const persist = () => {
      try {
        window.localStorage?.setItem(STORAGE_KEY, theme);
      } catch {
        // Ignore quota errors; theme still applies for the current session.
      }
      set({ theme });
    };

    // Set the origin coordinates on :root so view-transitions.css can
    // animate clip-path: circle(... at <x> <y>). Defaults to center
    // when no origin is provided (e.g. keyboard toggle).
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (origin) {
        root.style.setProperty("--vt-origin-x", `${origin.x}px`);
        root.style.setProperty("--vt-origin-y", `${origin.y}px`);
      } else {
        root.style.setProperty("--vt-origin-x", "50%");
        root.style.setProperty("--vt-origin-y", "50%");
      }
    }

    const start = getStartViewTransition();
    if (start && !prefersReducedMotion()) {
      start(() => {
        applyThemeAttribute(theme);
      });
      persist();
      return;
    }

    // Fallback path (no View Transitions API or reduced motion).
    if (prefersReducedMotion()) {
      applyThemeAttribute(theme);
    } else {
      applyThemeFallback(theme);
    }
    persist();
  },
  toggle: (origin) => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next, origin);
  },
}));

if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-theme", readInitial());
}
