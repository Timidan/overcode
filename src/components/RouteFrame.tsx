import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ActiveModelBadge } from "./ActiveModelBadge";
import "./RouteFrame.css";

interface RouteFrameProps {
  /** The current screen identifier. Used as a React key so the
   *  frame unmounts + remounts (and replays the enter animation)
   *  whenever the route changes. */
  screen: string;
  children: ReactNode;
}

/**
 * RouteFrame wraps the active screen and replays a short enter
 * animation every time `screen` changes. The animation itself is
 * defined in `src/styles/animations.css` (`.route-frame[data-enter]`).
 *
 * Usage (wire from the main agent's App.tsx):
 *
 *   import { RouteFrame } from './components/RouteFrame';
 *   ...
 *   <RouteFrame screen={screen}>{renderScreen(screen)}</RouteFrame>
 */
function RouteFrameInner({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Flip data-enter on for one frame so the CSS animation triggers
  // exactly once per mount. requestAnimationFrame ensures the browser
  // has committed the initial paint before we toggle the attribute off
  // (the CSS uses `animation` with `both`, so the end state sticks).
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.setAttribute("data-enter", "true");
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        // Leave data-enter on; CSS animation `both` keeps the final
        // state. We only remove it after the animation completes so a
        // re-trigger (forced by key change) restarts cleanly.
        window.setTimeout(() => {
          node.removeAttribute("data-enter");
        }, 260);
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="route-frame" ref={ref}>
      <ActiveModelBadge />
      {children}
    </div>
  );
}

export function RouteFrame({ screen, children }: RouteFrameProps) {
  return <RouteFrameInner key={screen}>{children}</RouteFrameInner>;
}
