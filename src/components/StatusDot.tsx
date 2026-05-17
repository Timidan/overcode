import "./StatusDot.css";

interface StatusDotProps {
  type: string;
}

type Variant = "live" | "remote" | "warn" | "error" | "muted";

function classify(type: string): Variant {
  switch (type) {
    case "ci_pass":
    case "push":
    case "commit":
      return "live";
    case "pr_opened":
    case "pr_merged":
      return "remote";
    case "stash":
      return "warn";
    case "ci_fail":
      return "error";
    default:
      return "muted";
  }
}

export function StatusDot({ type }: StatusDotProps) {
  const variant = classify(type);
  return <span className={`status-dot status-dot-${variant}`} />;
}
