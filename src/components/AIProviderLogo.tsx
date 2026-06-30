import type { SVGProps } from "react";
import type { AIProviderId } from "../lib/ipc";
import "./AIProviderLogo.css";

type LogoId = AIProviderId | "cognee";
type LogoSize = "sm" | "md" | "lg";

const labels: Record<LogoId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  cognee: "Cognee",
};

function OpenRouterMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <rect x="7" y="7" width="50" height="50" rx="8" />
      <path d="M16 38h17c8 0 13-5 13-13v-1" />
      <path d="m41 18 6 6-6 6" />
      <text x="20" y="30">O</text>
      <text x="31" y="48">R</text>
    </svg>
  );
}

function OpenAIMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <path d="M32 7 53 19v26L32 57 11 45V19L32 7Z" />
      <path d="M22 24h20M22 40h20M24 24l-5 16M40 24l5 16" />
      <text x="32" y="37">AI</text>
    </svg>
  );
}

function AnthropicMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <rect x="8" y="8" width="48" height="48" rx="6" />
      <path d="M19 45 32 17l13 28" />
      <path d="M25 34h14" />
      <text x="32" y="53">A</text>
    </svg>
  );
}

function GeminiMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <path d="M32 8c3 13 11 21 24 24-13 3-21 11-24 24-3-13-11-21-24-24 13-3 21-11 24-24Z" />
      <text x="32" y="39">G</text>
    </svg>
  );
}

function CogneeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <circle cx="32" cy="32" r="24" />
      <path d="M22 25h13c6 0 10 4 10 10s-4 10-10 10h-8" />
      <path d="M41 19v10M48 35h-9M41 51V41" />
      <circle cx="41" cy="19" r="3" />
      <circle cx="48" cy="35" r="3" />
      <circle cx="41" cy="51" r="3" />
      <text x="25" y="41">C</text>
    </svg>
  );
}

const marks: Record<LogoId, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  openrouter: OpenRouterMark,
  openai: OpenAIMark,
  anthropic: AnthropicMark,
  gemini: GeminiMark,
  cognee: CogneeMark,
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
  const Mark = marks[providerId];
  return (
    <span
      className={`ai-provider-logo is-${size} is-${providerId}`}
      aria-hidden={decorative ? true : undefined}
    >
      <Mark
        className="ai-provider-logo-mark"
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : labels[providerId]}
        focusable="false"
      />
    </span>
  );
}
