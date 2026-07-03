import anthropicLogo from "../assets/providers/anthropic.png";
import cogneeLogo from "../assets/providers/cognee.png";
import geminiLogo from "../assets/providers/gemini.svg";
import nvidiaLogo from "../assets/providers/nvidia.svg";
import openaiLogo from "../assets/providers/openai.svg";
import openrouterLogo from "../assets/providers/openrouter.png";
import type { AIProviderId } from "../lib/ipc";
import "./AIProviderLogo.css";

type LogoId = AIProviderId | "cognee";
type LogoSize = "sm" | "md" | "lg";

const labels: Record<LogoId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  nvidia: "NVIDIA NIM",
  cognee: "Cognee",
};

const logoSources: Record<LogoId, string> = {
  openrouter: openrouterLogo,
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: geminiLogo,
  nvidia: nvidiaLogo,
  cognee: cogneeLogo,
};

export function AIProviderLogo({
  providerId,
  size = "md",
  decorative = false,
}: {
  providerId: LogoId;
  size?: LogoSize;
  decorative?: boolean;
}) {
  const label = labels[providerId];
  return (
    <span
      className={`ai-provider-logo is-${size} is-${providerId}`}
      aria-hidden={decorative ? true : undefined}
    >
      <img
        src={logoSources[providerId]}
        alt={decorative ? "" : label}
        className="ai-provider-logo-mark"
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
