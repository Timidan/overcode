import { describe, expect, it } from "vitest";
import { preprocessForMarkdown } from "./pr-message-preprocess";

describe("PRMessage markdown preprocessing", () => {
  it("escapes remote raw HTML before internal placeholders are inserted", () => {
    const output = preprocessForMarkdown(
      '<img src=x onerror=alert(1)> @alice changed src/App.tsx:12',
    );

    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).not.toContain("<img");
    expect(output).toContain('<mark data-kind="mention" data-user="alice"></mark>');
    expect(output).toContain(
      '<mark data-kind="fileref" data-path="src/App.tsx" data-line="12"></mark>',
    );
  });

  it("keeps fenced code escaped and undecorated", () => {
    const output = preprocessForMarkdown(
      "```tsx\n<script>alert(1)</script>\nconst ref = 'src/App.tsx:12 @alice';\n```",
    );

    expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("<mark");
  });
});
