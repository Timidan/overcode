import { describe, expect, it } from "vitest";
import { getVisibleModelTags, summarizeModelCatalog } from "./ai-provider-model-browser";

describe("AI provider model browser helpers", () => {
  it("summarizes the loaded catalog and current result count", () => {
    expect(summarizeModelCatalog(338, 72)).toBe("338 models loaded - 72 matching");
    expect(summarizeModelCatalog(338, 338)).toBe("338 models loaded");
  });

  it("limits visible row tags and reports the hidden count", () => {
    expect(getVisibleModelTags(["free", "coding", "recommended", "long_context", "vision"])).toEqual({
      visibleTags: ["free", "coding", "recommended"],
      hiddenTagCount: 2,
    });
  });
});
