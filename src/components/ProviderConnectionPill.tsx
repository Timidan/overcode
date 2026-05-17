import { GithubLogo, GitlabLogo, Check, Plug } from "@phosphor-icons/react";
import "./ProviderConnectionPill.css";

export type Provider = "github" | "gitlab";
export type ProviderState = "disconnected" | "connecting" | "connected";

interface Props {
  provider: Provider;
  state: ProviderState;
  onConnect: () => void;
  onDisconnect: () => void;
  variant?: "pill" | "row";
}

const LABELS: Record<Provider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

export function ProviderConnectionPill({
  provider,
  state,
  onConnect,
  onDisconnect,
  variant = "pill",
}: Props) {
  const Logo = provider === "github" ? GithubLogo : GitlabLogo;
  const label = LABELS[provider];
  const isConnected = state === "connected";
  const isConnecting = state === "connecting";

  const ariaLabel = isConnected
    ? `${label} connected. Click to disconnect.`
    : isConnecting
      ? `Connecting to ${label}`
      : `Connect ${label}`;

  function handleClick() {
    if (isConnecting) return;
    if (isConnected) onDisconnect();
    else onConnect();
  }

  if (variant === "pill") {
    return (
      <button
        type="button"
        className={`provider-pill-mini provider-pill-${provider}`}
        data-state={state}
        onClick={handleClick}
        disabled={isConnecting}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <Logo size={16} weight="fill" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`provider-pill provider-pill-row provider-pill-${provider}`}
      data-state={state}
      onClick={handleClick}
      disabled={isConnecting}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className="provider-pill-ring" aria-hidden="true" />
      <span className="provider-pill-icon">
        <Logo size={18} weight="fill" />
        {isConnected && (
          <span className="provider-pill-check" aria-hidden="true">
            <Check size={8} weight="bold" />
          </span>
        )}
      </span>
      <span className="provider-pill-label">
        {isConnecting ? "Authorizing…" : isConnected ? label : `Connect ${label}`}
      </span>
      {!isConnected && !isConnecting && (
        <Plug size={11} weight="bold" className="provider-pill-action-icon" />
      )}
      {isConnected && <span className="provider-pill-halo" aria-hidden="true" />}
    </button>
  );
}
