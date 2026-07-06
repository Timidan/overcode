import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const siteHtml = readFileSync(join(process.cwd(), "site/index.html"), "utf8");

describe("landing page content", () => {
  test("leads with useful product content instead of decorative release markers", () => {
    expect(siteHtml).not.toContain('class="datestamp"');
    expect(siteHtml).not.toContain('class="hero-number"');
    expect(siteHtml).not.toContain('class="row-index"');
    expect(siteHtml).not.toContain("section 01");
    expect(siteHtml).not.toContain("section 02");
    expect(siteHtml).toContain('id="hero-title"');
  });

  test("imports the Overcode UI demo video directly", () => {
    expect(siteHtml).toContain('class="interface-reel-video"');
    expect(siteHtml).toContain('src="./assets/overcodeV2.mp4"');
    expect(siteHtml).toContain('poster="./assets/overcodeV2-poster.png"');
    expect(siteHtml).not.toContain("overcode-demo.mp4");
    expect(siteHtml).toContain("autoplay");
    expect(siteHtml).toContain("muted");
    expect(siteHtml).toContain("loop");
    expect(siteHtml).toContain("playsinline");
    expect(existsSync(join(process.cwd(), "site/assets/overcodeV2.mp4"))).toBe(true);
    expect(existsSync(join(process.cwd(), "site/assets/overcodeV2-poster.png"))).toBe(true);
  });
});
