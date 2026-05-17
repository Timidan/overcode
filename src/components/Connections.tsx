import { useEffect, useState } from "react";
import { ipc, type AuthProfile } from "../lib/ipc";
import {
  ProviderConnectionPill,
  type Provider,
  type ProviderState,
} from "./ProviderConnectionPill";
import "./Connections.css";

interface State {
  github: AuthProfile | null;
  gitlab: AuthProfile | null;
}

export function Connections() {
  const [state, setState] = useState<State>({ github: null, gitlab: null });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const status = await ipc.getAuthStatus();
      const next: State = { github: null, gitlab: null };
      if (status.github) {
        next.github = { username: "connected", avatar_url: "" };
      }
      if (status.gitlab) {
        next.gitlab = { username: "connected", avatar_url: "" };
      }
      setState(next);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function connect(provider: Provider) {
    setBusy(provider);
    setError(null);
    try {
      const profile = await ipc.connectAuth(provider);
      setState((s) => ({ ...s, [provider]: profile }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Connection failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: Provider) {
    setBusy(provider);
    setError(null);
    try {
      await ipc.disconnectAuth(provider);
      setState((s) => ({ ...s, [provider]: null }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Disconnect failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  function stateFor(provider: Provider): ProviderState {
    if (busy === provider) return "connecting";
    return state[provider] ? "connected" : "disconnected";
  }

  return (
    <div className="connections">
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
      {error && (
        <div className="connections-error" title={error}>
          !
        </div>
      )}
    </div>
  );
}
