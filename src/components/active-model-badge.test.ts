import { describe, expect, it } from "vitest";
import {
  buildActiveModelSummary,
  healthTone,
  providerName,
  shortModelLabel,
} from "./active-model-badge";

describe("active model badge helpers", () => {
  it("shortens provider-scoped model ids without hiding the important model name", () => {
    expect(shortModelLabel("meta/llama-4-maverick-17b-128e-instruct")).toBe("llama 4 maverick");
    expect(shortModelLabel("qwen/qwen3-next-80b-a3b-instruct")).toBe("qwen3 next 80b");
    expect(shortModelLabel("gpt-4.1-mini")).toBe("gpt 4.1 mini");
  });

  it("names supported providers for compact badge copy", () => {
    expect(providerName("openrouter")).toBe("OpenRouter");
    expect(providerName("nvidia")).toBe("NVIDIA NIM");
    expect(providerName(undefined)).toBe("AI");
  });

  it("builds configured tooltip details from status and provider rows", () => {
    const summary = buildActiveModelSummary({
      aiStatus: {
        configured: true,
        model: "meta/llama-4-maverick-17b-128e-instruct",
        missing: [],
        env: {
          OPENROUTER_API_KEY: "configured",
          OPENAI_API_KEY: "missing",
          ANTHROPIC_API_KEY: "missing",
          GEMINI_API_KEY: "missing",
          NVIDIA_API_KEY: "configured",
        },
        health: [{
          model: "meta/llama-4-maverick-17b-128e-instruct",
          status: "unknown",
          checkedAt: null,
        }],
      },
      providers: [{
        providerId: "nvidia",
        configured: true,
        active: true,
        credentialSource: "env",
        baseUrlSource: "default",
        health: "unknown",
      }],
    });

    expect(summary).toMatchObject({
      providerId: "nvidia",
      providerLabel: "NVIDIA NIM",
      visibleModel: "llama 4 maverick",
      statusLabel: "Configured",
      tone: "unknown",
    });
    expect(summary.tooltipLines).toEqual([
      "Provider: NVIDIA NIM",
      "Model: meta/llama-4-maverick-17b-128e-instruct",
      "Credentials: env",
      "Health: unknown",
    ]);
  });

  it("builds not-configured tooltip details with missing keys", () => {
    const summary = buildActiveModelSummary({
      aiStatus: {
        configured: false,
        model: "openrouter/free",
        missing: ["OPENROUTER_API_KEY"],
        env: {
          OPENROUTER_API_KEY: "missing",
          OPENAI_API_KEY: "missing",
          ANTHROPIC_API_KEY: "missing",
          GEMINI_API_KEY: "missing",
          NVIDIA_API_KEY: "missing",
        },
        health: [],
      },
      providers: [{
        providerId: "openrouter",
        configured: false,
        active: true,
        credentialSource: "none",
        baseUrlSource: "default",
        health: "not_configured",
      }],
    });

    expect(summary.statusLabel).toBe("Not configured");
    expect(summary.tone).toBe("not-configured");
    expect(summary.tooltipLines).toContain("Missing: OPENROUTER_API_KEY");
  });

  it("maps health states to badge tones", () => {
    expect(healthTone("available")).toBe("available");
    expect(healthTone("unavailable")).toBe("unavailable");
    expect(healthTone("not_configured")).toBe("not-configured");
    expect(healthTone(undefined)).toBe("unknown");
  });
});
