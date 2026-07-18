import type { ReactNode } from "react";
import { ActiveModelBadge } from "./ActiveModelBadge";
import "./RouteFrame.css";

interface RouteFrameProps {
  children: ReactNode;
}

export function RouteFrame({ children }: RouteFrameProps) {
  return (
    <div className="route-frame">
      <ActiveModelBadge />
      {children}
    </div>
  );
}
