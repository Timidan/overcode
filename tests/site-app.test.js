import { describe, expect, test } from "vitest";

import site from "../site/app.js";

const {
  FALLBACK_RELEASE,
  createReleaseModel,
  detectPlatform,
  detectPlatformSafe,
  formatBytes,
  formatReleaseDate,
  getPrimaryDownloadState,
  resolveReelSpeed,
} = site;

describe("interface reel speed", () => {
  test("plays the baked file speed by default and honors a sane ?speed override", () => {
    expect(resolveReelSpeed("")).toBe(1);
    expect(resolveReelSpeed("?speed=0.35")).toBe(0.35);
    expect(resolveReelSpeed("?speed=abc")).toBe(1);
    expect(resolveReelSpeed("?speed=9")).toBe(1);
  });
});

describe("site platform detection", () => {
  test.each([
    [
      "windows from userAgentData",
      { userAgentDataPlatform: "Windows", platform: "MacIntel", userAgent: "" },
      "windows",
    ],
    [
      "mac from platform",
      { userAgentDataPlatform: "", platform: "MacIntel", userAgent: "" },
      "mac",
    ],
    [
      "linux from user agent",
      {
        userAgentDataPlatform: "",
        platform: "",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      },
      "linux",
    ],
    [
      "android stays unknown",
      {
        userAgentDataPlatform: "",
        platform: "Linux armv8l",
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
      },
      "unknown",
    ],
  ])("%s", (_name, input, expected) => {
    expect(detectPlatform(input)).toBe(expected);
  });

  test("treats iPadOS desktop-mode Safari as unknown instead of mac", () => {
    const ipad = {
      userAgentDataPlatform: "",
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    };

    expect(detectPlatformSafe(ipad)).toBe("unknown");
    expect(detectPlatformSafe({ ...ipad, maxTouchPoints: 0 })).toBe("mac");
  });
});

describe("site release model", () => {
  test("keeps the baked fallback useful without network data", () => {
    const model = createReleaseModel(null);

    expect(model.version).toBe("v0.1.1");
    expect(model.platforms.windows.asset.name).toBe("Overcode-Windows-0.1.1-Setup.exe");
    expect(model.platforms.windows.asset.sizeLabel).toBe("83.0 MB");
    expect(model.platforms.linux.asset.name).toBe("Overcode-Linux-0.1.1.AppImage");
    expect(model.platforms.linux.asset.sizeLabel).toBe("113.4 MB");
    expect(model.platforms.mac.status).toBe("in-progress");
  });

  test("normalizes the latest GitHub release assets while keeping missing platforms honest", () => {
    const model = createReleaseModel({
      tag_name: "v0.2.0",
      assets: [
        {
          name: "Overcode-Windows-0.2.0-Setup.exe",
          size: 90_177_536,
          browser_download_url: "https://example.test/windows.exe",
        },
        {
          name: "Overcode-Linux-0.2.0.AppImage",
          size: 122_683_392,
          browser_download_url: "https://example.test/linux.AppImage",
        },
        {
          name: "latest.yml",
          size: 812,
          browser_download_url: "https://example.test/latest.yml",
        },
      ],
    });

    expect(model.version).toBe("v0.2.0");
    expect(model.platforms.windows.asset.url).toBe("https://example.test/windows.exe");
    expect(model.platforms.windows.asset.sizeLabel).toBe("90.2 MB");
    expect(model.platforms.linux.asset.url).toBe("https://example.test/linux.AppImage");
    expect(model.platforms.linux.asset.sizeLabel).toBe("122.7 MB");
    expect(model.platforms.mac.asset).toBeNull();
    expect(model.platforms.mac.status).toBe("in-progress");
  });

  test("upgrades macOS to available once a dmg ships in the latest release", () => {
    const model = createReleaseModel({
      tag_name: "v0.2.0",
      published_at: "2026-08-01T12:00:00Z",
      assets: [
        {
          name: "Overcode-Mac-0.2.0-Installer.dmg",
          size: 95_000_000,
          browser_download_url: "https://example.test/mac.dmg",
        },
      ],
    });

    expect(model.date).toBe("2026.08.01");
    expect(model.platforms.mac.status).toBe("available");
    expect(model.platforms.mac.asset.url).toBe("https://example.test/mac.dmg");
    expect(model.platforms.mac.asset.sizeLabel).toBe("95.0 MB");
    expect(getPrimaryDownloadState("mac", model)).toMatchObject({
      kind: "download",
      label: "download for macOS",
    });
  });

  test("formats release dates and falls back when the timestamp is unusable", () => {
    expect(formatReleaseDate("2026-07-05T03:14:04Z")).toBe("2026.07.05");
    expect(formatReleaseDate("not a date")).toBe(FALLBACK_RELEASE.date);
    expect(formatReleaseDate(undefined)).toBe(FALLBACK_RELEASE.date);
  });

  test("creates the right primary state for each detected platform", () => {
    expect(getPrimaryDownloadState("windows", FALLBACK_RELEASE)).toMatchObject({
      kind: "download",
      label: "download for Windows",
    });
    expect(getPrimaryDownloadState("linux", FALLBACK_RELEASE)).toMatchObject({
      kind: "download",
      label: "download for Linux",
    });
    expect(getPrimaryDownloadState("mac", FALLBACK_RELEASE)).toMatchObject({
      kind: "unavailable",
      label: "macOS build not shipped yet",
    });
    expect(getPrimaryDownloadState("unknown", FALLBACK_RELEASE)).toMatchObject({
      kind: "anchor",
      label: "see all downloads",
    });
  });

  test("formats GitHub byte sizes as decimal megabytes", () => {
    expect(formatBytes(83_000_000)).toBe("83.0 MB");
    expect(formatBytes(113_400_000)).toBe("113.4 MB");
  });
});
