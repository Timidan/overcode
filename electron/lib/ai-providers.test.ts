import { describe, expect, it } from "vitest";
import {
  curatedModelsForProvider,
  normalizeOpenRouterCatalog,
  OPENROUTER_FREE_MODEL_ID,
} from "./ai-providers";

describe("AI provider model catalogs", () => {
  it("classifies OpenRouter free and paid models from pricing", () => {
    const result = normalizeOpenRouterCatalog({
      data: [
        {
          id: "qwen/qwen3-coder:free",
          name: "Qwen: Qwen3 Coder 480B A35B (free)",
          pricing: { prompt: "0", completion: "0" },
          context_length: 1048576,
          architecture: { modality: "text->text" },
        },
        {
          id: "minimax/minimax-m3",
          name: "MiniMax: MiniMax M3",
          pricing: { prompt: "0.0000003", completion: "0.0000012" },
          context_length: 1000000,
          architecture: { modality: "text->text" },
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        providerId: "openrouter",
        id: "qwen/qwen3-coder:free",
        free: true,
        contextLength: 1048576,
        tags: expect.arrayContaining(["free", "coding", "recommended"]),
      }),
      expect.objectContaining({
        providerId: "openrouter",
        id: "minimax/minimax-m3",
        free: false,
        tags: expect.arrayContaining(["paid"]),
      }),
    ]);
  });

  it("returns curated fallback models for every supported provider", () => {
    expect(OPENROUTER_FREE_MODEL_ID).toBe("openrouter/free");
    expect(curatedModelsForProvider("openrouter").map((m) => m.id)).toContain("openrouter/free");
    expect(curatedModelsForProvider("openai").length).toBeGreaterThan(0);
    expect(curatedModelsForProvider("anthropic").length).toBeGreaterThan(0);
    expect(curatedModelsForProvider("gemini").length).toBeGreaterThan(0);
  });
});
