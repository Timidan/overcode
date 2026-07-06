(function initOvercodeSite(root) {
  "use strict";

  const REPO_URL = "https://github.com/Timidan/overcode";
  const RELEASES_URL = `${REPO_URL}/releases`;
  const LATEST_RELEASE_API =
    "https://api.github.com/repos/Timidan/overcode/releases/latest";
  const THEME_STORAGE_KEY = "overcode-site-theme";
  // The reel file is baked at 0.2x of the original capture speed (the raw
  // recording was too brisk to follow). Play it as-is; ?speed= tunes on top.
  const DEFAULT_REEL_SPEED = 1;

  function resolveReelSpeed(search) {
    const raw = Number(new URLSearchParams(search || "").get("speed"));

    if (Number.isFinite(raw) && raw >= 0.1 && raw <= 2) {
      return raw;
    }

    return DEFAULT_REEL_SPEED;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);

    if (!Number.isFinite(value) || value <= 0) {
      return "unknown size";
    }

    return `${(value / 1_000_000).toFixed(1)} MB`;
  }

  function makeAsset(name, url, sizeBytes) {
    return {
      name,
      url,
      sizeBytes,
      sizeLabel: formatBytes(sizeBytes),
    };
  }

  const FALLBACK_RELEASE = {
    version: "v0.1.1",
    date: "2026.07.05",
    platforms: {
      windows: {
        id: "windows",
        label: "Windows",
        arch: "x64",
        status: "available",
        asset: makeAsset(
          "Overcode-Windows-0.1.1-Setup.exe",
          `${RELEASES_URL}/download/v0.1.1/Overcode-Windows-0.1.1-Setup.exe`,
          82_999_336,
        ),
      },
      linux: {
        id: "linux",
        label: "Linux",
        arch: "x86_64",
        status: "available",
        asset: makeAsset(
          "Overcode-Linux-0.1.1.AppImage",
          `${RELEASES_URL}/download/v0.1.1/Overcode-Linux-0.1.1.AppImage`,
          113_415_468,
        ),
      },
      mac: {
        id: "mac",
        label: "macOS",
        arch: "universal",
        status: "in-progress",
        asset: null,
      },
      source: {
        id: "source",
        label: "build from source",
        arch: "npm",
        status: "source",
        asset: {
          name: "GitHub readme",
          url: `${REPO_URL}#running-from-source`,
          sizeBytes: 0,
          sizeLabel: "source",
        },
      },
    },
  };

  function cloneRelease(model) {
    return {
      version: model.version,
      date: model.date,
      platforms: Object.fromEntries(
        Object.entries(model.platforms).map(([key, platform]) => [
          key,
          {
            ...platform,
            asset: platform.asset ? { ...platform.asset } : null,
          },
        ]),
      ),
    };
  }

  function normalizeTag(tagName) {
    const value = typeof tagName === "string" ? tagName.trim() : "";

    if (!value) {
      return FALLBACK_RELEASE.version;
    }

    return value.startsWith("v") ? value : `v${value}`;
  }

  function formatReleaseDate(value) {
    const date = new Date(typeof value === "string" ? value : "");

    if (Number.isNaN(date.getTime())) {
      return FALLBACK_RELEASE.date;
    }

    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    return `${date.getUTCFullYear()}.${month}.${day}`;
  }

  function findReleaseAsset(assets, platform) {
    const candidates = Array.isArray(assets) ? assets : [];

    return candidates.find((asset) => {
      const name = typeof asset?.name === "string" ? asset.name.toLowerCase() : "";

      if (!name || name.includes("blockmap") || name.endsWith(".yml")) {
        return false;
      }

      if (platform === "windows") {
        return name.includes("windows") && name.includes("setup") && name.endsWith(".exe");
      }

      if (platform === "linux") {
        return name.includes("linux") && name.endsWith(".appimage");
      }

      if (platform === "mac") {
        return name.endsWith(".dmg");
      }

      return false;
    });
  }

  function normalizeAsset(asset, fallbackAsset) {
    if (!asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") {
      return { ...fallbackAsset };
    }

    const sizeBytes = Number(asset.size);

    return {
      name: asset.name,
      url: asset.browser_download_url,
      sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : fallbackAsset.sizeBytes,
      sizeLabel:
        Number.isFinite(sizeBytes) && sizeBytes > 0
          ? formatBytes(sizeBytes)
          : fallbackAsset.sizeLabel,
    };
  }

  function createReleaseModel(release) {
    if (!release || !Array.isArray(release.assets)) {
      return cloneRelease(FALLBACK_RELEASE);
    }

    const model = cloneRelease(FALLBACK_RELEASE);
    model.version = normalizeTag(release.tag_name || release.name);
    model.date = formatReleaseDate(release.published_at);
    model.platforms.windows.asset = normalizeAsset(
      findReleaseAsset(release.assets, "windows"),
      FALLBACK_RELEASE.platforms.windows.asset,
    );
    model.platforms.linux.asset = normalizeAsset(
      findReleaseAsset(release.assets, "linux"),
      FALLBACK_RELEASE.platforms.linux.asset,
    );

    const macAsset = findReleaseAsset(release.assets, "mac");

    if (macAsset && typeof macAsset.browser_download_url === "string") {
      const macSize = Number(macAsset.size);

      model.platforms.mac.status = "available";
      model.platforms.mac.asset = makeAsset(
        typeof macAsset.name === "string" ? macAsset.name : "Overcode macOS installer",
        macAsset.browser_download_url,
        Number.isFinite(macSize) && macSize > 0 ? macSize : 0,
      );
    }

    return model;
  }

  function detectPlatform(input) {
    const source = input || {};
    const uaDataPlatform = String(source.userAgentDataPlatform || "").toLowerCase();
    const platform = String(source.platform || "").toLowerCase();
    const userAgent = String(source.userAgent || "").toLowerCase();
    const combined = `${uaDataPlatform} ${platform} ${userAgent}`;

    if (/android|iphone|ipad|ipod/.test(combined)) {
      return "unknown";
    }

    if (uaDataPlatform.includes("win")) {
      return "windows";
    }

    if (uaDataPlatform.includes("mac")) {
      return "mac";
    }

    if (uaDataPlatform.includes("linux")) {
      return "linux";
    }

    if (/win32|win64|windows|wow64/.test(combined)) {
      return "windows";
    }

    if (/macintel|macintosh|mac os|darwin/.test(combined)) {
      return "mac";
    }

    if (/linux|x11/.test(combined)) {
      return "linux";
    }

    return "unknown";
  }

  function detectPlatformSafe(input) {
    const detected = detectPlatform(input);
    const touchPoints = Number((input || {}).maxTouchPoints);

    // iPadOS Safari reports "MacIntel" with a desktop user agent; the touch
    // count is the only signal left that this is not a Mac that can run a dmg.
    if (detected === "mac" && Number.isFinite(touchPoints) && touchPoints > 1) {
      return "unknown";
    }

    return detected;
  }

  function readNavigatorPlatform(navigatorRef) {
    const navigatorSource = navigatorRef || {};

    return {
      userAgentDataPlatform: navigatorSource.userAgentData?.platform || "",
      platform: navigatorSource.platform || "",
      userAgent: navigatorSource.userAgent || "",
      maxTouchPoints: navigatorSource.maxTouchPoints || 0,
    };
  }

  function getPrimaryDownloadState(platform, releaseModel) {
    const model = releaseModel || FALLBACK_RELEASE;
    const platformModel = model.platforms[platform];

    const downloadable = platform === "windows" || platform === "linux" || platform === "mac";

    if (downloadable && platformModel?.asset && platformModel.status === "available") {
      return {
        kind: "download",
        label: `download for ${platformModel.label}`,
        href: platformModel.asset.url,
        meta: `${model.version} · ${platformModel.asset.sizeLabel}`,
      };
    }

    if (platform === "mac") {
      return {
        kind: "unavailable",
        label: "macOS build not shipped yet",
        href: RELEASES_URL,
        meta: "watch releases on GitHub",
      };
    }

    return {
      kind: "anchor",
      label: "see all downloads",
      href: "#downloads",
      meta: "choose Windows, Linux, or source",
    };
  }

  function query(documentRef, selector) {
    return documentRef.querySelector(selector);
  }

  function queryAll(documentRef, selector) {
    return Array.from(documentRef.querySelectorAll(selector));
  }

  function setText(target, value) {
    if (target) {
      target.textContent = value;
    }
  }

  function setTheme(documentRef, theme) {
    const safeTheme = theme === "light" ? "light" : "dark";
    const rootElement = documentRef.documentElement;
    const toggle = query(documentRef, "[data-theme-toggle]");
    const themeMeta = query(documentRef, 'meta[name="theme-color"]');

    rootElement.dataset.theme = safeTheme;

    if (toggle) {
      toggle.setAttribute("aria-pressed", safeTheme === "light" ? "true" : "false");
      toggle.textContent = `theme: ${safeTheme}`;
    }

    if (themeMeta) {
      themeMeta.setAttribute("content", safeTheme === "light" ? "#f4ecd8" : "#1a1814");
    }
  }

  function resolveInitialTheme(windowRef) {
    try {
      const query = new URLSearchParams(windowRef.location?.search || "").get("theme");

      if (query === "light" || query === "dark") {
        return query;
      }

      const stored = windowRef.localStorage?.getItem(THEME_STORAGE_KEY);

      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch (_error) {
      return "dark";
    }

    return windowRef.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function persistTheme(windowRef, theme) {
    try {
      windowRef.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch (_error) {
      return;
    }
  }

  function applyPrimaryState(documentRef, platform, releaseModel) {
    const state = getPrimaryDownloadState(platform, releaseModel);
    const download = query(documentRef, "[data-primary-download]");
    const unavailable = query(documentRef, "[data-primary-unavailable]");
    const unavailableLink = query(documentRef, "[data-primary-unavailable-link]");

    if (state.kind === "unavailable") {
      if (download) {
        download.hidden = true;
      }

      if (unavailable) {
        unavailable.hidden = false;
        setText(query(unavailable, "[data-primary-unavailable-label]"), state.label);
        setText(query(unavailable, "[data-primary-unavailable-meta]"), state.meta);
      }

      if (unavailableLink) {
        unavailableLink.href = state.href;
      }

      return;
    }

    if (unavailable) {
      unavailable.hidden = true;
    }

    if (download) {
      download.hidden = false;
      download.href = state.href;
      download.dataset.primaryKind = state.kind;
      setText(query(download, "[data-primary-label]"), state.label);
      setText(query(download, "[data-primary-meta]"), state.meta);
    }
  }

  function applyDownloadRow(documentRef, platform, releaseModel, detectedPlatform) {
    const row = query(documentRef, `[data-download-platform="${platform}"]`);
    const platformModel = releaseModel.platforms[platform];

    if (!row || !platformModel) {
      return;
    }

    const isDetected = detectedPlatform === platform;

    row.classList.toggle("is-detected", isDetected);
    row.setAttribute("aria-current", isDetected ? "true" : "false");

    const flag = query(row, "[data-detected-flag]");

    if (flag) {
      flag.hidden = !isDetected;
    }

    setText(query(row, "[data-download-version]"), releaseModel.version);
    setText(
      query(row, "[data-download-artifact]"),
      platformModel.asset?.name || "in progress · watch releases",
    );
    setText(query(row, "[data-download-size]"), platformModel.asset?.sizeLabel || "not shipped");

    const action = query(row, "[data-download-link]");

    if (!action) {
      return;
    }

    if (platformModel.asset?.url) {
      action.href = platformModel.asset.url;
      action.textContent = platformModel.status === "source" ? "read source steps" : "download";
      action.setAttribute("aria-label", `${action.textContent} ${platformModel.label}`);
      return;
    }

    action.href = RELEASES_URL;
    action.textContent = "watch releases";
    action.setAttribute("aria-label", `watch releases for ${platformModel.label}`);
  }

  function applyReleaseModel(documentRef, platform, releaseModel) {
    queryAll(documentRef, "[data-release-version]").forEach((target) => {
      target.textContent = releaseModel.version;
    });

    queryAll(documentRef, "[data-release-date]").forEach((target) => {
      target.textContent = releaseModel.date;
    });
    applyPrimaryState(documentRef, platform, releaseModel);
    ["windows", "linux", "mac", "source"].forEach((targetPlatform) => {
      applyDownloadRow(documentRef, targetPlatform, releaseModel, platform);
    });
  }

  function startSite(documentRef, windowRef) {
    const detectedPlatform = detectPlatformSafe(readNavigatorPlatform(windowRef.navigator));
    const themeToggle = query(documentRef, "[data-theme-toggle]");
    let currentTheme = resolveInitialTheme(windowRef);

    documentRef.documentElement.dataset.detectedPlatform = detectedPlatform;
    setTheme(documentRef, currentTheme);
    applyReleaseModel(documentRef, detectedPlatform, FALLBACK_RELEASE);

    const reel = query(documentRef, ".interface-reel-video");

    if (reel) {
      const speed = resolveReelSpeed(windowRef.location?.search);

      reel.defaultPlaybackRate = speed;
      reel.playbackRate = speed;
    }

    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        currentTheme = currentTheme === "dark" ? "light" : "dark";
        setTheme(documentRef, currentTheme);
        persistTheme(windowRef, currentTheme);
      });
    }

    if (typeof windowRef.fetch !== "function") {
      return;
    }

    windowRef
      .fetch(LATEST_RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
        },
      })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`GitHub release fetch failed: ${response.status}`);
        }

        return response.json();
      })
      .then((release) => {
        applyReleaseModel(documentRef, detectedPlatform, createReleaseModel(release));
      })
      .catch(() => {
        applyReleaseModel(documentRef, detectedPlatform, FALLBACK_RELEASE);
      });
  }

  const api = {
    FALLBACK_RELEASE,
    createReleaseModel,
    detectPlatform,
    detectPlatformSafe,
    formatBytes,
    formatReleaseDate,
    getPrimaryDownloadState,
    resolveReelSpeed,
    startSite,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OvercodeSite = api;

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => {
        startSite(root.document, root);
      });
    } else {
      startSite(root.document, root);
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
