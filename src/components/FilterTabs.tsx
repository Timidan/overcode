import { useLayoutEffect, useRef, useState } from "react";
import "./FilterTabs.css";

type Filter = "ALL" | "LOCAL" | "REMOTE";

interface FilterTabsProps {
  activeFilter: Filter;
  onFilterChange: (filter: Filter) => void;
}

const TITLES: Record<Filter, string> = {
  ALL: "Show all activity from local, GitHub, and GitLab",
  LOCAL: "Show only local workspace activity",
  REMOTE: "Show only GitHub and GitLab activity",
};

const LABELS: Record<Filter, string> = {
  ALL: "All",
  LOCAL: "Local",
  REMOTE: "Remote",
};

const FILTERS = Object.keys(TITLES) as Filter[];

export function FilterTabs({ activeFilter, onFilterChange }: FilterTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<Filter, HTMLButtonElement | null>>({
    ALL: null,
    LOCAL: null,
    REMOTE: null,
  });
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });

  useLayoutEffect(() => {
    const target = tabRefs.current[activeFilter];
    const container = containerRef.current;
    if (!target || !container) return;
    const containerBox = container.getBoundingClientRect();
    const tabBox = target.getBoundingClientRect();
    setIndicator({
      left: tabBox.left - containerBox.left,
      width: tabBox.width,
      visible: true,
    });
  }, [activeFilter]);

  return (
    <div ref={containerRef} className="filter-tabs">
      <span
        className="filter-tabs-indicator"
        aria-hidden="true"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width,
          opacity: indicator.visible ? 1 : 0,
        }}
      />
      {FILTERS.map((filter) => (
        <button
          key={filter}
          ref={(el) => {
            tabRefs.current[filter] = el;
          }}
          type="button"
          className={`filter-tab ${activeFilter === filter ? "active" : ""}`}
          title={TITLES[filter]}
          onClick={() => onFilterChange(filter)}
        >
          {LABELS[filter]}
        </button>
      ))}
    </div>
  );
}
