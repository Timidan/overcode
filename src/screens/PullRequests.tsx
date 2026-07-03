import { useEffect, useState } from "react";
import { Sidebar } from "../components/Sidebar";
import { PRCard } from "../components/PRCard";
import {
  ProviderConnectionPill,
  type Provider,
  type ProviderState,
} from "../components/ProviderConnectionPill";
import {
  loadCollaborationItems,
  type PRCardData,
} from "../lib/collaboration";
import { ipc } from "../lib/ipc";
import "./PullRequests.css";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PullRequests() {
  const [prs, setPrs] = useState<PRCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState({ github: false, gitlab: false });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await loadCollaborationItems();
        if (cancelled) return;
        setAuth(result.auth);
        setError(result.error);
        setPrs(result.items);
      } catch (error) {
        if (!cancelled) {
          setError(errorMessage(error, "Failed to load pull requests"));
          setPrs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function connect(provider: Provider) {
    setBusy(provider);
    try {
      await ipc.connectAuth(provider);
      const status = await ipc.getAuthStatus();
      setAuth(status);
      // Refetch in place; a full window reload loses navigation state.
      setReloadKey((key) => key + 1);
    } catch (error) {
      setError(errorMessage(error, "Connection failed"));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: Provider) {
    setBusy(provider);
    try {
      await ipc.disconnectAuth(provider);
      setAuth(await ipc.getAuthStatus());
    } catch (error) {
      setError(errorMessage(error, "Disconnect failed"));
    } finally {
      setBusy(null);
    }
  }

  function stateFor(provider: Provider): ProviderState {
    if (busy === provider) return "connecting";
    return auth[provider] ? "connected" : "disconnected";
  }

  return (
    <div className="pr-screen-container">
      <Sidebar />
      <main className="pr-screen-main">
        <header className="pr-screen-header">
          <h1 className="pr-screen-title">Pull requests</h1>
          <div className="pr-screen-meta">
            <ProviderConnectionPill
              provider="github"
              state={stateFor("github")}
              onConnect={() => connect("github")}
              onDisconnect={() => disconnect("github")}
            />
            <ProviderConnectionPill
              provider="gitlab"
              state={stateFor("gitlab")}
              onConnect={() => connect("gitlab")}
              onDisconnect={() => disconnect("gitlab")}
            />
          </div>
        </header>

        {error && <div className="pr-screen-error">{error}</div>}

        {loading && (
          <div className="pr-screen-skel" aria-busy="true" aria-hidden="true">
            <span className="pr-screen-skel-row" />
            <span className="pr-screen-skel-row" />
            <span className="pr-screen-skel-row" />
          </div>
        )}

        {!loading && prs.length === 0 && (
          <div className="pr-screen-empty">
            {!auth.github && !auth.gitlab
              ? "Connect GitHub or GitLab to see your pull requests."
              : "No open pull requests across your connected accounts."}
          </div>
        )}

        <div className="pr-screen-list">
          {prs.map((pr, index) => (
            <PRCard key={pr.id} pr={pr} staggerIndex={index} />
          ))}
        </div>
      </main>
    </div>
  );
}
