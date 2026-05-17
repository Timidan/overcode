import "./BranchBadge.css";

interface BranchBadgeProps {
  branch: string;
}

export function BranchBadge({ branch }: BranchBadgeProps) {
  return <span className="branch-badge">{branch}</span>;
}

