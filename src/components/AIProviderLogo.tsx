import type { AIProviderId } from "../lib/ipc";
import openrouterLogo from "../assets/providers/openrouter.svg";
import openaiLogo from "../assets/providers/openai.svg";
import anthropicLogo from "../assets/providers/anthropic.svg";
import geminiLogo from "../assets/providers/gemini.svg";
import cogneeLogo from "../assets/providers/cognee.svg";
import "./AIProviderLogo.css";

type LogoId = AIProviderId | "cognee";

const logos: Record<LogoId, string> = {
  openrouter: openrouterLogo,
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: geminiLogo,
  cognee: cogneeLogo,
};

const labels: Record<LogoId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  cognee: "Cognee",
};

export function AIProviderLogo({
  providerId,
  size = "md",
  decorative = false,
}: {
  providerId: LogoId;
  size?: "sm" | "md" | "lg";
  decorative?: boolean;
}) {
  return (
    <img
      className={`ai-provider-logo is-${size}`}
      src={logos[providerId]}
      alt={decorative ? "" : labels[providerId]}
      aria-hidden={decorative ? true : undefined}
      loading="lazy"
    />
  );
}
