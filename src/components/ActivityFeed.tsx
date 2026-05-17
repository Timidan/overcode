import { useEffect, useMemo, useState } from "react";
import { FixedSizeList as List } from "react-window";
import { FilterTabs } from "./FilterTabs";
import { ActivityItem } from "./ActivityItem";
import {
  buildRepositoryLookup,
  filterActivityByWorkspace,
  loadWorkspaceData,
  type ActivityFilter,
  type WorkspaceActivity,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import "./ActivityFeed.css";

interface ActivityFeedProps {
  /** Bump this when the underlying store activity changes to force a re-read. */
  refreshKey?: number;
  items?: WorkspaceActivity[];
  repositories?: WorkspaceRepository[];
}

export function ActivityFeed({
  refreshKey = 0,
  items: providedItems,
  repositories: providedRepositories,
}: ActivityFeedProps) {
  const [storedItems, setStoredItems] = useState<WorkspaceActivity[]>([]);
  const [storedRepositories, setStoredRepositories] = useState<WorkspaceRepository[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>("ALL");

  useEffect(() => {
    if (providedItems && providedRepositories) return;
    let cancelled = false;
    async function loadData() {
      const data = await loadWorkspaceData();
      if (cancelled) return;
      setStoredItems(data.activity);
      setStoredRepositories(data.repositories);
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [providedItems, providedRepositories, refreshKey]);

  const items = providedItems ?? storedItems;
  const repositories = providedRepositories ?? storedRepositories;

  const repositoriesById = useMemo(
    () => buildRepositoryLookup(repositories),
    [repositories],
  );
  const filteredItems = useMemo(
    () => filterActivityByWorkspace(items, repositoriesById, filter),
    [filter, items, repositoriesById],
  );

  return (
    <div className="activity-feed">
      <FilterTabs activeFilter={filter} onFilterChange={setFilter} />
      <div className="activity-list-container">
        <List
          height={400}
          itemCount={filteredItems.length}
          itemSize={64}
          width="100%"
        >
          {({
            index,
            style,
          }: {
            index: number;
            style: React.CSSProperties;
          }) => (
            <div style={style}>
              <ActivityItem
                item={filteredItems[index]}
                repository={repositoriesById.get(filteredItems[index].repo_id)}
              />
            </div>
          )}
        </List>
      </div>
    </div>
  );
}
