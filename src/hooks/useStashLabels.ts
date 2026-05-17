import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { getStashLabel } from "../lib/ai-features";

interface Stash {
  ref: string;
  message: string;
  date: string;
}

export function useStashLabels(repoId: string, repoPath: string) {
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const lastRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++lastRequestRef.current;
    setLoading(true);
    setLabels({});

    if (!repoPath) {
      setStashes([]);
      setLoading(false);
      return;
    }

    try {
      const real = await ipc.getStashes(repoPath);
      if (requestId !== lastRequestRef.current) return;
      const realStashes = real as Stash[];
      setStashes(realStashes);

      const nextLabels: Record<string, string> = {};
      for (const stash of realStashes) {
        try {
          const diff = await ipc.getStashDiff(repoPath, stash.ref);
          if (requestId !== lastRequestRef.current) return;
          if (!diff) {
            nextLabels[stash.ref] = stash.message;
          } else {
            nextLabels[stash.ref] = await getStashLabel(repoId, {
              ref: stash.ref,
              diff,
              message: stash.message,
            });
          }
        } catch {
          nextLabels[stash.ref] = stash.message;
        }
        if (requestId !== lastRequestRef.current) return;
        setLabels({ ...nextLabels });
      }
    } catch {
      if (requestId === lastRequestRef.current) {
        setStashes([]);
        setLabels({});
      }
    } finally {
      if (requestId === lastRequestRef.current) setLoading(false);
    }
  }, [repoId, repoPath]);

  useEffect(() => {
    load();
  }, [load]);

  return { stashes, labels, loading, refresh: load };
}
