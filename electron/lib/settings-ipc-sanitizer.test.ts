import { describe, expect, it } from "vitest";
import {
  sanitizeSettingsForRendererRead,
  sanitizeSettingsForRendererWrite,
} from "./settings-ipc-sanitizer";

describe("settings IPC sanitizer", () => {
  it("strips provider secrets and provider-managed storage from renderer reads", () => {
    expect(
      sanitizeSettingsForRendererRead({
        watch_directories: ["~/projects"],
        ai_provider_id: "openai",
        ai_provider_secrets: {
          openai: { value: "sk-live-secret" },
        },
        ai_provider_base_urls: {
          openai: "https://api.openai.com/v1",
        },
        openrouter_api_key: "legacy-key",
        openrouter_api_key_secret: { value: "legacy-secret" },
        openrouter_base_url: "https://openrouter.ai/api/v1",
      }),
    ).toEqual({
      watch_directories: ["~/projects"],
      ai_provider_id: "openai",
    });
  });

  it("preserves existing provider-managed storage and rejects renderer supplied secret fields", () => {
    expect(
      sanitizeSettingsForRendererWrite(
        {
          watch_directories: ["~/Desktop"],
          ai_provider_id: "anthropic",
          ai_provider_secrets: {
            anthropic: { value: "renderer-secret" },
          },
          ai_provider_base_urls: {
            anthropic: "https://malicious.example",
          },
          openrouter_api_key: "renderer-legacy-key",
          openrouter_api_key_secret: { value: "renderer-legacy-secret" },
          openrouter_base_url: "https://renderer.example",
        },
        {
          watch_directories: ["~/projects"],
          ai_provider_secrets: {
            openai: { value: "stored-openai-secret" },
          },
          ai_provider_base_urls: {
            openai: "https://api.openai.com/v1",
          },
          openrouter_api_key: "stored-legacy-key",
          openrouter_api_key_secret: { value: "stored-legacy-secret" },
          openrouter_base_url: "https://openrouter.ai/api/v1",
        },
      ),
    ).toEqual({
      watch_directories: ["~/Desktop"],
      ai_provider_id: "anthropic",
      ai_provider_secrets: {
        openai: { value: "stored-openai-secret" },
      },
      ai_provider_base_urls: {
        openai: "https://api.openai.com/v1",
      },
      openrouter_api_key: "stored-legacy-key",
      openrouter_api_key_secret: { value: "stored-legacy-secret" },
      openrouter_base_url: "https://openrouter.ai/api/v1",
    });
  });
});
