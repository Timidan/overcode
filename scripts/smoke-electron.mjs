import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const APP_ROOT = process.cwd();
const DIST_MAIN = path.join(APP_ROOT, "dist-electron", "main.js");
const ELECTRON_BIN =
  process.platform === "win32"
    ? path.join(APP_ROOT, "node_modules", "electron", "dist", "electron.exe")
    : path.join(APP_ROOT, "node_modules", "electron", "dist", "electron");
const TIMEOUT_MS = 45_000;

class CdpClient {
  constructor(url) {
    if (typeof WebSocket !== "function") {
      throw new Error("This smoke script requires a Node runtime with WebSocket.");
    }
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  call(method, params = {}, timeoutMs = TIMEOUT_MS) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  close() {
    this.socket.close();
  }
}

async function main() {
  await assertBuiltApp();
  const port = await getFreePort();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcode-smoke-"));
  const child = launchElectron(port, userDataDir);
  let client;

  try {
    const target = await waitForRendererTarget(port, child);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.call("Runtime.enable");
    const result = await evaluateSmoke(client);
    console.log(JSON.stringify(result, null, 2));
    validateSmokeResult(result);
  } finally {
    client?.close();
    child.kill("SIGTERM");
    const exited = await waitForExit(child, 2000);
    if (!exited) {
      child.kill("SIGKILL");
      await waitForExit(child, 2000);
    }
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

async function assertBuiltApp() {
  try {
    await fs.access(DIST_MAIN);
    await fs.access(ELECTRON_BIN);
  } catch {
    throw new Error(
      "Built Electron app not found. Run `vite build` before smoke:electron.",
    );
  }
}

function launchElectron(port, userDataDir) {
  const output = [];
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    OVERCODE_REMOTE_DEBUGGING_PORT: String(port),
    OVERCODE_SMOKE_USER_DATA_DIR: userDataDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    ELECTRON_BIN,
    [APP_ROOT],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  child.smokeOutput = output;
  return child;
}

async function waitForRendererTarget(port, child) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(
        `Electron exited early with code ${child.exitCode}\n${tailOutput(child)}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === "page" && target.webSocketDebuggerUrl,
        );
        if (page) return page;
      }
    } catch {
      // DevTools endpoint is not listening yet.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for Electron renderer target.");
}

function tailOutput(child) {
  return (child.smokeOutput ?? []).join("").slice(-2000);
}

async function evaluateSmoke(client) {
  const scanPaths = [
    path.join(os.homedir(), "projects"),
    path.join(os.homedir(), "Desktop", "persona"),
    path.join(os.homedir(), "Desktop"),
  ];
  const expression = `(${rendererSmoke.toString()})(${JSON.stringify(scanPaths)}, ${JSON.stringify(APP_ROOT)})`;
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Renderer smoke evaluation failed";
    throw new Error(text);
  }
  return result.result.value;
}

async function rendererSmoke(scanPaths, appRoot) {
  function withTimeout(promise, timeoutMs, fallback) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  }

  async function waitForViewport(timeoutMs = 5_000) {
    const started = Date.now();
    let viewport;
    do {
      viewport = {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
      };
      if (viewport.innerWidth > 0 && viewport.innerHeight > 0) return viewport;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() - started < timeoutMs);
    return viewport;
  }

  const started = Date.now();
  while (!window.api && Date.now() - started < 10_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!window.api) throw new Error("window.api was not exposed by preload.");

  const auth = await window.api.auth.status();
  const ai = await withTimeout(window.api.ai.status(), 15_000, {
    error: "ai.status timed out",
  }).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const storeProbe = { timestamp: Date.now() };
  await window.api.store.set("smoke:electron", storeProbe);
  const stored = await window.api.store.get("smoke:electron");
  const storeKeys = await window.api.store.list();
  const repos = await withTimeout(
    window.api.git.scan(scanPaths),
    20_000,
    [],
  );
  const localRepo =
    repos.find((repo) => repo.local_path === appRoot) ??
    repos.find((repo) => repo.local_path?.endsWith("/overcode")) ??
    { name: "overcode", local_path: appRoot };
  const status = localRepo
    ? await window.api.git.status(localRepo.local_path)
    : null;

  return {
    hasApi: true,
    viewport: await waitForViewport(),
    apiKeys: Object.keys(window.api).sort(),
    auth,
    ai: "health" in ai
      ? {
          configured: ai.configured,
          model: ai.model,
          health: ai.health.map((entry) => ({
            model: entry.model,
            status: entry.status,
          })),
        }
      : ai,
    store: {
      hasProbe: JSON.stringify(stored) === JSON.stringify(storeProbe),
      keyCount: storeKeys.length,
    },
    repos: {
      count: repos.length,
      github: repos.filter((repo) => repo.platform === "github").length,
      gitlab: repos.filter((repo) => repo.platform === "gitlab").length,
      local: repos.filter((repo) => repo.platform === "local").length,
      sample: repos.slice(0, 8).map((repo) => ({
        name: repo.name,
        platform: repo.platform,
        path: repo.local_path,
      })),
    },
    firstStatus: status
      ? {
          repo: localRepo.name,
          branch: status.branch,
          fileCount: status.files.length,
          fileTreeCount: status.fileTree.length,
          hasReadme: status.readme.length > 0,
          hasDiffFields:
            typeof status.diff === "string" &&
            typeof status.stagedDiff === "string",
        }
      : null,
  };
}

function validateSmokeResult(result) {
  const failures = [];
  if (!result?.hasApi) failures.push("window.api missing");
  if (!result?.apiKeys?.includes("git")) failures.push("git API missing");
  if (!result?.apiKeys?.includes("ai")) failures.push("ai API missing");
  if (!result?.store?.hasProbe) failures.push("store get/set failed");
  if (result?.viewport) {
    const { innerWidth, innerHeight, outerWidth, outerHeight } = result.viewport;
    if (outerWidth >= 1200 && innerWidth < 1200) {
      failures.push(`renderer viewport too narrow (${innerWidth}px inside ${outerWidth}px window)`);
    }
    if (outerHeight >= 800 && innerHeight < 760) {
      failures.push(`renderer viewport too short (${innerHeight}px inside ${outerHeight}px window)`);
    }
  } else {
    failures.push("renderer viewport metrics missing");
  }
  if (!result?.repos || result.repos.count < 1) failures.push("workspace scan returned no repos");
  if (!result?.firstStatus) failures.push("git status was not exercised");
  if (result?.firstStatus && !result.firstStatus.hasDiffFields) {
    failures.push("git status missing diff fields");
  }
  if (failures.length > 0) {
    throw new Error(`Electron smoke failed: ${failures.join(", ")}`);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not allocate a port."));
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      child.off("exit", onExit);
    }
    function onExit() {
      cleanup();
      resolve(true);
    }
    child.once("exit", onExit);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
