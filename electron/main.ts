// Must be first: side-effect import runs dotenv.config() before any other import body.
import "dotenv/config";
import { app, BrowserWindow, shell, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import path from "node:path";
import { registerIPCHandlers } from "./ipc-handlers";

// CJS bundle: __dirname is a native global. No fileURLToPath / import.meta dance needed.
process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

const smokeDebugPort = process.env.OVERCODE_REMOTE_DEBUGGING_PORT?.trim();
if (smokeDebugPort) {
  app.commandLine.appendSwitch("remote-debugging-port", smokeDebugPort);
}

// Opt-in sandbox bypass for Linux kernels that reject the bundled chrome-sandbox
// helper (some Arch/Manjaro and SELinux-enforcing systems). Default off.
const useLinuxPackagedNoSandbox =
  process.platform === "linux" && app.isPackaged && process.env.OVERCODE_NO_SANDBOX === "1";

if (useLinuxPackagedNoSandbox) {
  app.commandLine.appendSwitch("no-sandbox");
}

const smokeUserDataDir = process.env.OVERCODE_SMOKE_USER_DATA_DIR?.trim();
if (smokeUserDataDir) {
  app.setPath("userData", smokeUserDataDir);
}

let win: BrowserWindow | null = null;
let gitWorker: UtilityProcess | null = null;

const EXTERNAL_LINK_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
]);

function isAllowedExternalLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && EXTERNAL_LINK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function openAllowedExternalLink(url: string): void {
  if (isAllowedExternalLink(url)) {
    void shell.openExternal(url);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(process.env.VITE_PUBLIC, "overcode-icon-512.png"),
    backgroundColor: "#0e0e18",
    title: "Overcode",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !useLinuxPackagedNoSandbox,
    },
  });

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalLink(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  gitWorker?.kill();
  gitWorker = null;
});

function createGitWorker(): UtilityProcess {
  const worker = utilityProcess.fork(path.join(__dirname, "workers", "git-worker.js"));
  worker.once("exit", () => {
    if (gitWorker === worker) gitWorker = null;
  });
  return worker;
}

app.whenReady().then(() => {
  gitWorker = createGitWorker();
  registerIPCHandlers(gitWorker);
  createWindow();
});
