import simpleGit, { type SimpleGit } from "simple-git";
import nodePath from "node:path";
import { homedir } from "node:os";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import type { Repository, WorkspaceCandidate } from "./store";
import {
  scanSecrets,
  type SecretScanInputs,
  type SecretScanWarning,
} from "./secret-scanner";
import {
  detectTestCommands,
  type TestCommandSuggestion,
} from "./test-command-detector";

const MAX_SCAN_DEPTH = 4;
const MAX_TREE_ENTRIES = 160;
const MAX_TREE_DEPTH = 4;
const MAX_README_CHARS = 16_000;
const MAX_COMPARE_PATCH_CHARS = 24_000;
const MAX_INSPECT_FILE_BYTES = 220_000;
const ENV_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.test",
  ".env.production",
]);
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];

const IGNORED_DIRS = new Set([
  "node_modules",
  "bower_components",
  "jspm_packages",
  ".git",
  "dist",
  "dist-electron",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "third_party",
  "external",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".angular",
  ".vite",
  ".parcel-cache",
  ".cache",
  ".turbo",
  ".nx",
  ".yarn",
  ".pnpm",
  ".pnpm-store",
  "pnpm-store",
  ".npm",
  ".bun",
  ".gradle",
  ".m2",
  ".ivy2",
  ".cargo",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "env",
  ".direnv",
  "Pods",
  "DerivedData",
  ".terraform",
  ".serverless",
  ".sst",
  ".vercel",
  ".netlify",
  ".expo",
  ".vscode",
]);

interface WorkspaceProbe {
  path: string;
  hasGit: boolean;
  hasGithub: boolean;
}

interface LooseGitObject {
  type: string;
  body: Buffer;
}

interface CommitObjectSummary {
  tree: string;
  parents: string[];
}

interface TreeEntrySummary {
  path: string;
  mode: string;
  hash: string;
}

interface PackedObjectLocation {
  packPath: string;
  offset: number;
}

const packFileCache = new Map<string, Buffer>();
const packedObjectCache = new Map<string, LooseGitObject | null>();
const MAX_PACK_FILE_CACHE_ENTRIES = 8;
const MAX_PACK_OBJECT_CACHE_ENTRIES = 2_000;

export interface GitFile {
  path: string;
  status: "M" | "A" | "D" | "R" | "?" | "U";
  staged: boolean;
  // Per-file LOC from `git diff --numstat`. Undefined for binary files
  // (numstat emits `-\t-\t<path>`) and untracked entries (not in HEAD diff).
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  files: GitFile[];
  branch: string;
  ahead: number;
  behind: number;
  diff: string;
  stagedDiff: string;
  fileTree: string[];
  readme: string;
  packageSummary: string;
  environmentWarnings: EnvironmentWarning[];
  secretWarnings: SecretScanWarning[];
  testCommands: TestCommandSuggestion[];
}

export type GitStatusMode = "full" | "lite" | "diff" | "health";

export interface GitStatusOptions {
  mode?: GitStatusMode;
}

export interface EnvironmentWarning {
  kind:
    | "env"
    | "port"
    | "dependencies"
    | "lockfile"
    | "docker"
    | "scripts";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  paths: string[];
}

export interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface Stash {
  ref: string;
  message: string;
  date: string;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isMain?: boolean;
  locked?: boolean;
  prunable?: boolean;
  dirtyCount?: number;
  ahead?: number;
  behind?: number;
}

export interface WorktreeSummaryInput {
  repoPath: string;
  targetPath: string;
  base: string;
  target: string;
  baseRef: string;
  targetRef: string;
  branch: string;
  ahead: number;
  behind: number;
  dirtyFiles: number;
  diffStat: string;
  nameStatus: string;
  patch: string;
  uncommittedDiff: string;
  uniqueCommits: string[];
  changedFiles: string[];
  baseCandidates: string[];
  worktreeCandidates: Array<{
    path: string;
    branch: string;
    head: string;
    isMain?: boolean;
  }>;
}

export type WorktreeOptions =
  | undefined
  | { mode?: "list" }
  | { mode: "summary-input"; targetPath?: string; base?: string };

export type WorktreeResult = Worktree[] | WorktreeSummaryInput;
interface ParsedWorktree {
  path: string;
  branch: string;
  head: string;
  locked?: boolean;
  prunable?: boolean;
}

export interface Divergence {
  ahead: number;
  behind: number;
}

export interface RepoFileReadOptions {
  ref?: string;
  maxBytes?: number;
}

export interface RepoFileContent {
  path: string;
  ref?: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  encoding: "utf8" | "binary";
  source: "working-tree" | "git-ref";
  language: string;
}

function deriveRepoIdentity(
  remoteUrl: string | null,
  localPath: string,
  hasGithubMarker: boolean,
): {
  platform: Repository["platform"];
  name: string;
  remote_url?: string;
} {
  if (!remoteUrl) {
    return {
      platform: hasGithubMarker ? "github" : "local",
      name: nodePath.basename(localPath),
    };
  }
  if (remoteUrl.includes("github.com")) {
    return { platform: "github", name: nodePath.basename(localPath), remote_url: remoteUrl };
  }
  if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab.")) {
    return { platform: "gitlab", name: nodePath.basename(localPath), remote_url: remoteUrl };
  }
  return {
    platform: hasGithubMarker ? "github" : "local",
    name: nodePath.basename(localPath),
    remote_url: remoteUrl,
  };
}

function hasIgnoredSegment(pathToCheck: string): boolean {
  const segments = nodePath.normalize(pathToCheck).split(nodePath.sep).filter(Boolean);
  return segments.some((segment, index) => {
    if (IGNORED_DIRS.has(segment)) return true;
    return segment === "forge-std" && segments[index - 1] === "lib";
  });
}

function shouldSkipDirectory(parent: string, entry: Dirent): boolean {
  if (!entry.isDirectory()) return true;
  if (IGNORED_DIRS.has(entry.name)) return true;
  if (entry.name.startsWith(".")) return true;
  return entry.name === "forge-std" && nodePath.basename(parent) === "lib";
}

function hasGitMarker(entries: Dirent[]): boolean {
  return entries.some(
    (entry) =>
      entry.name === ".git" &&
      (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()),
  );
}

function hasGithubMarker(entries: Dirent[]): boolean {
  return entries.some(
    (entry) =>
      entry.name === ".github" &&
      (entry.isDirectory() || entry.isSymbolicLink()),
  );
}

async function canonicalPath(pathToCheck: string): Promise<string> {
  const resolved = nodePath.resolve(pathToCheck);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function findWorkspaceCandidates(
  root: string,
  depth = 0,
  maxDepth = MAX_SCAN_DEPTH,
): Promise<WorkspaceProbe[]> {
  if (depth > maxDepth) return [];
  if (hasIgnoredSegment(root)) return [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const hasGit = hasGitMarker(entries);
  const hasGithub = hasGithubMarker(entries);
  if (hasGit || hasGithub) {
    return [{ path: root, hasGit, hasGithub }];
  }

  const subResults: WorkspaceProbe[] = [];
  for (const entry of entries) {
    if (shouldSkipDirectory(root, entry)) continue;
    const child = nodePath.join(root, entry.name);
    const found = await findWorkspaceCandidates(child, depth + 1, maxDepth);
    subResults.push(...found);
  }
  return subResults;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return nodePath.join(homedir(), p.slice(2));
  }
  return p;
}

async function readOriginRemote(repoPath: string): Promise<string | null> {
  try {
    const remotes = await simpleGit(repoPath).getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (origin?.refs?.fetch) return origin.refs.fetch;
  } catch {
    // Fall through to direct .git/config parsing. Some judge/demo machines
    // have the repository files but no git binary on PATH.
  }
  return readOriginRemoteFromConfig(repoPath);
}

async function readOriginRemoteFromConfig(repoPath: string): Promise<string | null> {
  const gitDir = await resolveGitDir(repoPath);
  if (!gitDir) return null;
  const candidates = [
    nodePath.join(gitDir, "config"),
    nodePath.join(gitDir, "..", "..", "config"),
  ];
  for (const configPath of candidates) {
    const raw = await fs.readFile(configPath, "utf8").catch(() => "");
    if (!raw) continue;
    const remote = parseOriginRemoteConfig(raw);
    if (remote) return remote;
  }
  return null;
}

function parseOriginRemoteConfig(raw: string): string | null {
  const lines = raw.split(/\r?\n/);
  let inOrigin = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inOrigin = /^remote\s+"origin"$/i.test(section[1]);
      continue;
    }
    if (!inOrigin) continue;
    const url = /^url\s*=\s*(.+)$/.exec(line);
    if (url?.[1]) return url[1].trim();
  }
  return null;
}

async function collectFileTree(
  root: string,
  current = root,
  depth = 0,
  results: string[] = [],
): Promise<string[]> {
  if (depth > MAX_TREE_DEPTH || results.length >= MAX_TREE_ENTRIES) {
    return results;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return results;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (results.length >= MAX_TREE_ENTRIES) break;
    if (entry.name === ".github") {
      results.push(nodePath.relative(root, nodePath.join(current, entry.name)));
      continue;
    }
    if (entry.isDirectory() && shouldSkipDirectory(current, entry)) continue;
    if (entry.name === ".git") continue;
    const absolutePath = nodePath.join(current, entry.name);
    const relativePath = nodePath.relative(root, absolutePath);
    if (!relativePath) continue;
    results.push(relativePath);
    if (entry.isDirectory()) {
      await collectFileTree(root, absolutePath, depth + 1, results);
    }
  }

  return results;
}

async function readReadme(repoPath: string): Promise<string> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(repoPath, { withFileTypes: true });
  } catch {
    return "";
  }

  const readme = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .find((name) => /^readme(\.|$)/i.test(name));
  if (!readme) return "";

  try {
    return (await fs.readFile(nodePath.join(repoPath, readme), "utf8")).slice(
      0,
      MAX_README_CHARS,
    );
  } catch {
    return "";
  }
}

async function readPackageSummary(repoPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(nodePath.join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      name?: string;
      version?: string;
      description?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = Object.keys(pkg.scripts ?? {}).slice(0, 12);
    const dependencies = Object.keys(pkg.dependencies ?? {}).slice(0, 20);
    const devDependencies = Object.keys(pkg.devDependencies ?? {}).slice(0, 20);
    return [
      pkg.name ? `name: ${pkg.name}` : "",
      pkg.version ? `version: ${pkg.version}` : "",
      pkg.description ? `description: ${pkg.description}` : "",
      scripts.length ? `scripts: ${scripts.join(", ")}` : "",
      dependencies.length ? `dependencies: ${dependencies.join(", ")}` : "",
      devDependencies.length
        ? `devDependencies: ${devDependencies.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

async function collectEnvironmentWarnings(repoPath: string): Promise<EnvironmentWarning[]> {
  const warnings: EnvironmentWarning[] = [];
  const entries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((entry) => entry.name));
  const packageJsonPath = nodePath.join(repoPath, "package.json");
  const packageInfo = await readPackageInfo(packageJsonPath);

  const envWarnings = await collectEnvFileWarnings(repoPath, names);
  warnings.push(...envWarnings);

  if (names.has("package.json")) {
    const hasNodeModules = names.has("node_modules");
    if (!hasNodeModules) {
      warnings.push({
        kind: "dependencies",
        severity: "medium",
        title: "Dependencies not installed",
        detail: "package.json exists but node_modules is missing in this workspace.",
        paths: ["package.json"],
      });
    }

    const scriptNames = Object.keys(packageInfo.scripts);
    if (scriptNames.length > 0) {
      warnings.push({
        kind: "scripts",
        severity: "low",
        title: "Runnable scripts detected",
        detail: scriptNames.slice(0, 8).join(", "),
        paths: ["package.json"],
      });
    }

    const scriptPorts = extractPorts(Object.values(packageInfo.scripts).join("\n"));
    if (scriptPorts.length > 0) {
      warnings.push({
        kind: "port",
        severity: "medium",
        title: "Dev ports in package scripts",
        detail: `Ports: ${scriptPorts.join(", ")}`,
        paths: ["package.json"],
      });
    }
  }

  const lockfiles = LOCKFILES.filter((name) => names.has(name));
  if (lockfiles.length > 1) {
    warnings.push({
      kind: "lockfile",
      severity: "medium",
      title: "Multiple package lockfiles",
      detail: lockfiles.join(", "),
      paths: lockfiles,
    });
  }

  const composeFiles = Array.from(names).filter((name) =>
    /(^|[-.])compose\.ya?ml$|docker-compose\.ya?ml$/i.test(name),
  );
  for (const composeFile of composeFiles.slice(0, 4)) {
    const raw = await fs.readFile(nodePath.join(repoPath, composeFile), "utf8").catch(() => "");
    const ports = extractPorts(raw);
    warnings.push({
      kind: "docker",
      severity: ports.length > 0 ? "medium" : "low",
      title: ports.length > 0 ? "Docker ports detected" : "Docker compose file detected",
      detail: ports.length > 0 ? `Ports: ${ports.join(", ")}` : "Review service names before running multiple worktrees.",
      paths: [composeFile],
    });
  }

  return warnings.slice(0, 12);
}

async function readPackageInfo(packageJsonPath: string): Promise<{ scripts: Record<string, string> }> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return { scripts: parsed.scripts ?? {} };
  } catch {
    return { scripts: {} };
  }
}

async function collectEnvFileWarnings(
  repoPath: string,
  names: Set<string>,
): Promise<EnvironmentWarning[]> {
  const warnings: EnvironmentWarning[] = [];
  for (const name of Array.from(names).filter((entry) => ENV_FILE_NAMES.has(entry)).slice(0, 5)) {
    const raw = await fs.readFile(nodePath.join(repoPath, name), "utf8").catch(() => "");
    const keys = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]?.trim() ?? "")
      .filter(Boolean)
      .map(maskSensitiveEnvKey)
      .filter((key, index, all) => all.indexOf(key) === index)
      .slice(0, 12);
    const ports = extractPorts(raw);
    warnings.push({
      kind: ports.length > 0 ? "port" : "env",
      severity: ports.length > 0 ? "medium" : "low",
      title: `${name} detected`,
      detail: keys.length > 0
        ? `Keys: ${keys.join(", ")}${ports.length > 0 ? `; ports: ${ports.join(", ")}` : ""}`
        : "Environment file exists. Values are not exposed.",
      paths: [name],
    });
  }
  return warnings;
}

function maskSensitiveEnvKey(key: string): string {
  if (/(SECRET|TOKEN|API[_-]?KEY|PASSWORD|PRIVATE|ACCESS[_-]?KEY)/i.test(key)) {
    return "[sensitive key]";
  }
  return key;
}

function extractPorts(value: string): string[] {
  const ports = new Set<string>();
  const patterns = [
    /(?:PORT|port)\s*[:=]\s*["']?(\d{2,5})/g,
    /(?:localhost|127\.0\.0\.1):(\d{2,5})/g,
    /(?:--port|-p)\s+(\d{2,5})/g,
    /["']?(\d{2,5}):\d{2,5}["']?/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const port = match[1];
      if (!port) continue;
      const numeric = Number(port);
      if (numeric >= 80 && numeric <= 65535) ports.add(port);
    }
  }
  return Array.from(ports).slice(0, 12);
}

async function resolveGitDir(repoPath: string): Promise<string | null> {
  const markerPath = nodePath.join(repoPath, ".git");
  try {
    const marker = await fs.lstat(markerPath);
    if (marker.isDirectory()) return markerPath;
    if (!marker.isFile() && !marker.isSymbolicLink()) return null;
    const raw = await fs.readFile(markerPath, "utf8");
    const match = raw.match(/^gitdir:\s*(.+)\s*$/i);
    if (!match?.[1]) return null;
    return nodePath.resolve(repoPath, match[1].trim());
  } catch {
    return null;
  }
}

async function readBranchNameFromGitFiles(repoPath: string): Promise<string> {
  const gitDir = await resolveGitDir(repoPath);
  if (!gitDir) return "HEAD";
  try {
    const rawHead = (await fs.readFile(nodePath.join(gitDir, "HEAD"), "utf8")).trim();
    const refMatch = rawHead.match(/^ref:\s+refs\/heads\/(.+)$/);
    if (refMatch?.[1]) return refMatch[1];
    return rawHead.slice(0, 7) || "HEAD";
  } catch {
    return "HEAD";
  }
}

async function readLogFileCandidates(repoPath: string): Promise<string[]> {
  const gitDir = await resolveGitDir(repoPath);
  if (!gitDir) return [];
  const candidates = [nodePath.join(gitDir, "logs", "HEAD")];
  try {
    const rawHead = (await fs.readFile(nodePath.join(gitDir, "HEAD"), "utf8")).trim();
    const refMatch = rawHead.match(/^ref:\s+(.+)$/);
    if (refMatch?.[1]) {
      candidates.unshift(nodePath.join(gitDir, "logs", refMatch[1]));
    }
  } catch {
    // Fall back to logs/HEAD.
  }
  return candidates;
}

function parseGitLogLine(line: string): Commit | null {
  const tabIndex = line.indexOf("\t");
  if (tabIndex === -1) return null;
  const meta = line.slice(0, tabIndex);
  const message = line.slice(tabIndex + 1).replace(/^commit(?: \(.*\))?:\s*/, "");
  const match = meta.match(
    /^[0-9a-f]{40}\s+([0-9a-f]{40})\s+(.+)\s+(\d+)\s+[+-]\d{4}$/i,
  );
  if (!match) return null;
  const [, hash, authorRaw, timestamp] = match;
  if (/^0{40}$/.test(hash)) return null;
  const author = authorRaw.replace(/\s+<[^>]+>$/, "").trim() || "unknown";
  return {
    hash,
    message: message.trim() || "(no commit message)",
    author,
    date: new Date(Number(timestamp) * 1000).toISOString(),
  };
}

async function readCommitLogFromGitFiles(
  repoPath: string,
  maxCount: number,
): Promise<Commit[]> {
  for (const logFile of await readLogFileCandidates(repoPath)) {
    try {
      const raw = await fs.readFile(logFile, "utf8");
      const seen = new Set<string>();
      const commits: Commit[] = [];
      for (const line of raw.trim().split("\n").reverse()) {
        const commit = parseGitLogLine(line);
        if (!commit || seen.has(commit.hash)) continue;
        seen.add(commit.hash);
        commits.push(commit);
        if (commits.length >= maxCount) break;
      }
      if (commits.length > 0) return commits;
    } catch {
      // Try the next candidate log file.
    }
  }
  return [];
}

async function expandCommitHashFromGitFiles(
  repoPath: string,
  hash: string,
): Promise<string | null> {
  if (/^[0-9a-f]{40}$/i.test(hash)) return hash.toLowerCase();
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) return null;
  const commits = await readCommitLogFromGitFiles(repoPath, 500);
  const match = commits.find((commit) => commit.hash.startsWith(hash.toLowerCase()));
  return match?.hash ?? null;
}

async function readLooseGitObject(
  repoPath: string,
  hash: string,
): Promise<LooseGitObject | null> {
  if (!/^[0-9a-f]{40}$/i.test(hash)) return null;
  const gitDir = await resolveGitDir(repoPath);
  if (!gitDir) return null;
  for (const objectsDir of await gitObjectDirs(gitDir)) {
    const objectPath = nodePath.join(
      objectsDir,
      hash.slice(0, 2),
      hash.slice(2),
    );
    try {
      const compressed = await fs.readFile(objectPath);
      const inflated = zlib.inflateSync(compressed);
      const headerEnd = inflated.indexOf(0);
      if (headerEnd <= 0) continue;
      const header = inflated.subarray(0, headerEnd).toString("utf8");
      const [type] = header.split(" ");
      if (!type) continue;
      return { type, body: inflated.subarray(headerEnd + 1) };
    } catch {
      // Try the next object directory. Linked worktrees keep objects in the
      // common git dir, not the per-worktree gitdir.
    }
  }
  return null;
}

async function resolveGitCommonDir(gitDir: string): Promise<string> {
  try {
    const raw = (await fs.readFile(nodePath.join(gitDir, "commondir"), "utf8")).trim();
    if (raw) return nodePath.resolve(gitDir, raw);
  } catch {
    // Standard repositories do not have a commondir file.
  }
  return gitDir;
}

async function gitObjectDirs(gitDir: string): Promise<string[]> {
  const commonDir = await resolveGitCommonDir(gitDir);
  return Array.from(
    new Set([
      nodePath.join(gitDir, "objects"),
      nodePath.join(commonDir, "objects"),
    ]),
  );
}

async function readGitObject(
  repoPath: string,
  hash: string,
): Promise<LooseGitObject | null> {
  const loose = await readLooseGitObject(repoPath, hash);
  if (loose) return loose;
  return readPackedGitObject(repoPath, hash);
}

async function readPackedGitObject(
  repoPath: string,
  hash: string,
): Promise<LooseGitObject | null> {
  const location = await findPackedObject(repoPath, hash);
  if (!location) return null;
  return readPackObjectAtOffset(location.packPath, location.offset);
}

async function findPackedObject(
  repoPath: string,
  hash: string,
): Promise<PackedObjectLocation | null> {
  if (!/^[0-9a-f]{40}$/i.test(hash)) return null;
  const gitDir = await resolveGitDir(repoPath);
  if (!gitDir) return null;
  const prefix = Number.parseInt(hash.slice(0, 2), 16);

  for (const objectsDir of await gitObjectDirs(gitDir)) {
    const packDir = nodePath.join(objectsDir, "pack");
    const entries = await fs.readdir(packDir).catch(() => []);

    for (const entry of entries) {
      if (!entry.endsWith(".idx")) continue;
      const idxPath = nodePath.join(packDir, entry);
      const idx = await fs.readFile(idxPath).catch(() => null);
      if (!idx || idx.length < 8 || idx.readUInt32BE(0) !== 0xff744f63) continue;
      const version = idx.readUInt32BE(4);
      if (version !== 2) continue;
      const fanoutOffset = 8;
      const objectCount = idx.readUInt32BE(fanoutOffset + 255 * 4);
      const hashOffset = fanoutOffset + 256 * 4;
      const start = prefix === 0 ? 0 : idx.readUInt32BE(fanoutOffset + (prefix - 1) * 4);
      const end = idx.readUInt32BE(fanoutOffset + prefix * 4);
      const crcOffset = hashOffset + objectCount * 20;
      const offsetsOffset = crcOffset + objectCount * 4;
      const largeOffsetsOffset = offsetsOffset + objectCount * 4;

      for (let index = start; index < end; index += 1) {
        const objectHash = idx
          .subarray(hashOffset + index * 20, hashOffset + (index + 1) * 20)
          .toString("hex");
        if (objectHash !== hash.toLowerCase()) continue;
        const rawOffset = idx.readUInt32BE(offsetsOffset + index * 4);
        let offset = rawOffset;
        if ((rawOffset & 0x80000000) !== 0) {
          const largeIndex = rawOffset & 0x7fffffff;
          const largeOffset = largeOffsetsOffset + largeIndex * 8;
          const high = idx.readUInt32BE(largeOffset);
          const low = idx.readUInt32BE(largeOffset + 4);
          offset = high * 0x100000000 + low;
        }
        return {
          packPath: nodePath.join(packDir, entry.replace(/\.idx$/, ".pack")),
          offset,
        };
      }
    }
  }

  return null;
}

async function readPackFile(packPath: string): Promise<Buffer> {
  const cached = packFileCache.get(packPath);
  if (cached) return cached;
  const buffer = await fs.readFile(packPath);
  packFileCache.set(packPath, buffer);
  if (packFileCache.size > MAX_PACK_FILE_CACHE_ENTRIES) {
    const oldest = packFileCache.keys().next().value;
    if (oldest) packFileCache.delete(oldest);
  }
  return buffer;
}

async function readPackObjectAtOffset(
  packPath: string,
  offset: number,
  seen = new Set<string>(),
): Promise<LooseGitObject | null> {
  const cacheKey = `${packPath}:${offset}`;
  if (packedObjectCache.has(cacheKey)) return packedObjectCache.get(cacheKey) ?? null;
  if (seen.has(cacheKey)) return null;
  seen.add(cacheKey);

  const pack = await readPackFile(packPath);
  if (pack.subarray(0, 4).toString("ascii") !== "PACK") return null;
  let cursor = offset;
  const startOffset = offset;
  const first = pack[cursor++];
  if (first === undefined) return null;
  const type = (first >> 4) & 0x07;
  let size = first & 0x0f;
  let shift = 4;
  let byte = first;
  while ((byte & 0x80) !== 0) {
    byte = pack[cursor++];
    if (byte === undefined) return null;
    size |= (byte & 0x7f) << shift;
    shift += 7;
  }

  let result: LooseGitObject | null = null;
  if (type === 6) {
    const baseOffset = readOffsetDeltaBase(pack, cursor, startOffset);
    cursor = baseOffset.nextCursor;
    const delta = zlib.inflateSync(pack.subarray(cursor));
    const base = await readPackObjectAtOffset(packPath, baseOffset.offset, seen);
    result = base ? { type: base.type, body: applyGitDelta(base.body, delta) } : null;
  } else if (type === 7) {
    const baseHash = pack.subarray(cursor, cursor + 20).toString("hex");
    cursor += 20;
    const delta = zlib.inflateSync(pack.subarray(cursor));
    const base = await readPackedGitObjectByPack(packPath, baseHash, seen);
    result = base ? { type: base.type, body: applyGitDelta(base.body, delta) } : null;
  } else {
    const objectType = packObjectTypeName(type);
    result = objectType
      ? { type: objectType, body: zlib.inflateSync(pack.subarray(cursor)) }
      : null;
  }

  packedObjectCache.set(cacheKey, result);
  if (packedObjectCache.size > MAX_PACK_OBJECT_CACHE_ENTRIES) {
    const oldest = packedObjectCache.keys().next().value;
    if (oldest) packedObjectCache.delete(oldest);
  }
  void size;
  return result;
}

async function readPackedGitObjectByPack(
  packPath: string,
  hash: string,
  seen: Set<string>,
): Promise<LooseGitObject | null> {
  const idxPath = packPath.replace(/\.pack$/, ".idx");
  const idx = await fs.readFile(idxPath).catch(() => null);
  if (!idx || idx.length < 8 || idx.readUInt32BE(0) !== 0xff744f63) return null;
  const version = idx.readUInt32BE(4);
  if (version !== 2) return null;
  const prefix = Number.parseInt(hash.slice(0, 2), 16);
  const fanoutOffset = 8;
  const objectCount = idx.readUInt32BE(fanoutOffset + 255 * 4);
  const hashOffset = fanoutOffset + 256 * 4;
  const start = prefix === 0 ? 0 : idx.readUInt32BE(fanoutOffset + (prefix - 1) * 4);
  const end = idx.readUInt32BE(fanoutOffset + prefix * 4);
  const crcOffset = hashOffset + objectCount * 20;
  const offsetsOffset = crcOffset + objectCount * 4;
  const largeOffsetsOffset = offsetsOffset + objectCount * 4;

  for (let index = start; index < end; index += 1) {
    const objectHash = idx.subarray(hashOffset + index * 20, hashOffset + (index + 1) * 20).toString("hex");
    if (objectHash !== hash.toLowerCase()) continue;
    const rawOffset = idx.readUInt32BE(offsetsOffset + index * 4);
    let offset = rawOffset;
    if ((rawOffset & 0x80000000) !== 0) {
      const largeIndex = rawOffset & 0x7fffffff;
      const largeOffset = largeOffsetsOffset + largeIndex * 8;
      offset = idx.readUInt32BE(largeOffset) * 0x100000000 + idx.readUInt32BE(largeOffset + 4);
    }
    return readPackObjectAtOffset(packPath, offset, seen);
  }

  return null;
}

function readOffsetDeltaBase(
  pack: Buffer,
  cursor: number,
  currentOffset: number,
): { offset: number; nextCursor: number } {
  let byte = pack[cursor++];
  if (byte === undefined) return { offset: currentOffset, nextCursor: cursor };
  let value = byte & 0x7f;
  while ((byte & 0x80) !== 0) {
    byte = pack[cursor++];
    if (byte === undefined) return { offset: currentOffset, nextCursor: cursor };
    value = ((value + 1) << 7) | (byte & 0x7f);
  }
  return { offset: currentOffset - value, nextCursor: cursor };
}

function packObjectTypeName(type: number): string | null {
  if (type === 1) return "commit";
  if (type === 2) return "tree";
  if (type === 3) return "blob";
  if (type === 4) return "tag";
  return null;
}

function readDeltaVarInt(delta: Buffer, cursor: number): { value: number; cursor: number } {
  let value = 0;
  let shift = 0;
  let byte = 0;
  do {
    byte = delta[cursor++];
    if (byte === undefined) return { value, cursor };
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0);
  return { value, cursor };
}

function applyGitDelta(base: Buffer, delta: Buffer): Buffer {
  let cursor = 0;
  const baseSize = readDeltaVarInt(delta, cursor);
  cursor = baseSize.cursor;
  const resultSize = readDeltaVarInt(delta, cursor);
  cursor = resultSize.cursor;
  const chunks: Buffer[] = [];
  let written = 0;

  while (cursor < delta.length) {
    const opcode = delta[cursor++];
    if ((opcode & 0x80) !== 0) {
      let copyOffset = 0;
      let copySize = 0;
      if (opcode & 0x01) copyOffset |= delta[cursor++];
      if (opcode & 0x02) copyOffset |= delta[cursor++] << 8;
      if (opcode & 0x04) copyOffset |= delta[cursor++] << 16;
      if (opcode & 0x08) copyOffset |= delta[cursor++] << 24;
      if (opcode & 0x10) copySize |= delta[cursor++];
      if (opcode & 0x20) copySize |= delta[cursor++] << 8;
      if (opcode & 0x40) copySize |= delta[cursor++] << 16;
      if (copySize === 0) copySize = 0x10000;
      chunks.push(base.subarray(copyOffset, copyOffset + copySize));
      written += copySize;
    } else if (opcode > 0) {
      chunks.push(delta.subarray(cursor, cursor + opcode));
      cursor += opcode;
      written += opcode;
    } else {
      throw new Error("Invalid git delta opcode.");
    }
  }

  if (baseSize.value !== base.length || written !== resultSize.value) {
    throw new Error("Invalid git delta object.");
  }
  return Buffer.concat(chunks, resultSize.value);
}

async function readCommitObjectSummary(
  repoPath: string,
  hash: string,
): Promise<CommitObjectSummary | null> {
  const object = await readGitObject(repoPath, hash);
  if (object?.type !== "commit") return null;
  const text = object.body.toString("utf8");
  const tree = /^tree ([0-9a-f]{40})$/im.exec(text)?.[1]?.toLowerCase();
  if (!tree) return null;
  const parents = Array.from(text.matchAll(/^parent ([0-9a-f]{40})$/gim))
    .map((match) => match[1]?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  return { tree, parents };
}

async function readTreeEntriesFromLooseObjects(
  repoPath: string,
  treeHash: string,
  prefix = "",
  entries = new Map<string, TreeEntrySummary>(),
  depth = 0,
): Promise<Map<string, TreeEntrySummary>> {
  if (depth > MAX_TREE_DEPTH + 20) return entries;
  const object = await readGitObject(repoPath, treeHash);
  if (object?.type !== "tree") return entries;

  let offset = 0;
  while (offset < object.body.length) {
    const modeEnd = object.body.indexOf(0x20, offset);
    if (modeEnd <= offset) break;
    const nameEnd = object.body.indexOf(0, modeEnd + 1);
    if (nameEnd <= modeEnd) break;
    const hashStart = nameEnd + 1;
    const hashEnd = hashStart + 20;
    if (hashEnd > object.body.length) break;

    const mode = object.body.subarray(offset, modeEnd).toString("utf8");
    const name = object.body.subarray(modeEnd + 1, nameEnd).toString("utf8");
    const childHash = object.body.subarray(hashStart, hashEnd).toString("hex");
    const fullPath = prefix ? `${prefix}/${name}` : name;
    offset = hashEnd;

    if (mode === "40000") {
      await readTreeEntriesFromLooseObjects(
        repoPath,
        childHash,
        fullPath,
        entries,
        depth + 1,
      );
      continue;
    }
    entries.set(fullPath, { path: fullPath, mode, hash: childHash });
  }

  return entries;
}

export async function scanRepos(directories: string[]): Promise<Repository[]> {
  const candidates = await scanWorkspaceCandidates(directories);
  return candidates
    .map(({ id, name, platform, remote_url, local_path, last_seen_at }) => ({
      id,
      name,
      platform,
      remote_url,
      local_path,
      last_synced: last_seen_at,
    }))
    .sort((a, b) => a.local_path.localeCompare(b.local_path));
}

export async function scanWorkspaceCandidates(
  directories: string[],
): Promise<WorkspaceCandidate[]> {
  const candidatesByPath = new Map<string, WorkspaceProbe>();

  for (const directory of directories) {
    const root = await canonicalPath(expandHome(directory));
    const found = await findWorkspaceCandidates(root);
    for (const candidate of found) {
      const pathKey = await canonicalPath(candidate.path);
      const existing = candidatesByPath.get(pathKey);
      candidatesByPath.set(pathKey, {
        path: pathKey,
        hasGit: candidate.hasGit || existing?.hasGit === true,
        hasGithub: candidate.hasGithub || existing?.hasGithub === true,
      });
    }
  }

  const now = Date.now();
  const results: WorkspaceCandidate[] = [];

  for (const candidate of candidatesByPath.values()) {
    const remoteUrl = candidate.hasGit ? await readOriginRemote(candidate.path) : null;
    const identity = deriveRepoIdentity(remoteUrl, candidate.path, candidate.hasGithub);
    // detected_from describes the on-disk marker, not whether a remote URL
    // exists. Local scans should never set this to "remote" — that value is
    // reserved for candidates surfaced by a remote provider (e.g. GitHub API).
    const detected_from: WorkspaceCandidate["detected_from"] = candidate.hasGit
      ? ".git"
      : ".github";
    results.push({
      id: `local:${candidate.path}`,
      name: identity.name,
      platform: identity.platform,
      remote_url: identity.remote_url,
      local_path: candidate.path,
      detected_from,
      discovered_at: now,
      last_seen_at: now,
    });
  }

  return results.sort((a, b) => a.local_path.localeCompare(b.local_path));
}


function git(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

// Guard against missing repos and .github-only workspace candidates.
async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const marker = await fs.lstat(nodePath.join(repoPath, ".git"));
    if (!marker.isDirectory() && !marker.isFile() && !marker.isSymbolicLink()) {
      return false;
    }
    try {
      return await git(repoPath).checkIsRepo();
    } catch {
      // The app can still provide file-tree, HEAD, and reflog fallback data
      // when a git binary is unavailable in the runtime PATH.
      return true;
    }
  } catch {
    return false;
  }
}

async function isInspectableWorkspaceRoot(repoPath: string): Promise<boolean> {
  for (const marker of [".git", ".github"]) {
    try {
      const stat = await fs.lstat(nodePath.join(repoPath, marker));
      if (stat.isDirectory() || stat.isFile() || stat.isSymbolicLink()) {
        return true;
      }
    } catch {
      // Try the next workspace marker.
    }
  }
  return false;
}

const EMPTY_STATUS: GitStatus = {
  files: [],
  branch: "HEAD",
  ahead: 0,
  behind: 0,
  diff: "",
  stagedDiff: "",
  fileTree: [],
  readme: "",
  packageSummary: "",
  environmentWarnings: [],
  secretWarnings: [],
  testCommands: [],
};

function normalizeStatusMode(options?: GitStatusOptions): GitStatusMode {
  return options?.mode === "lite" ||
    options?.mode === "diff" ||
    options?.mode === "health"
    ? options.mode
    : "full";
}

function statusModeFlags(mode: GitStatusMode): {
  includeDiff: boolean;
  includeTree: boolean;
  includeReadme: boolean;
  includePackage: boolean;
  includeEnvironment: boolean;
  includeIntelligence: boolean;
} {
  return {
    includeDiff: mode === "full" || mode === "diff",
    includeTree: mode === "full" || mode === "health",
    includeReadme: mode === "full",
    includePackage: mode === "full",
    includeEnvironment: mode === "full" || mode === "health",
    includeIntelligence: mode === "full" || mode === "health",
  };
}

async function collectStatusIntelligence(
  repoPath: string,
  inputs: SecretScanInputs,
): Promise<{
  secretWarnings: SecretScanWarning[];
  testCommands: TestCommandSuggestion[];
}> {
  const [secretWarnings, testCommands] = await Promise.all([
    scanSecrets(repoPath, inputs).catch(() => []),
    detectTestCommands(repoPath).catch(() => []),
  ]);
  return { secretWarnings, testCommands };
}

// Parse `git diff --numstat` output into a map keyed by path. Numstat lines
// look like `5\t2\tsrc/foo.ts`; binary files emit `-\t-\tlogo.png`. Renames
// emit `add\tdel\torig => new` (or with `{`/`}` brace syntax) — we key on the
// post-rename path so the UI attributes LOC to the new location.
interface NumstatEntry {
  additions: number | undefined;
  deletions: number | undefined;
}

function parseNumstat(raw: string): Map<string, NumstatEntry> {
  const entries = new Map<string, NumstatEntry>();
  if (!raw) return entries;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addStr, delStr, ...rest] = parts;
    const rawPath = rest.join("\t");
    // Rename forms: `old => new` or `dir/{old => new}/file`.
    const path = rawPath.includes("=>")
      ? rawPath
          .replace(/\{[^{}]*=>\s*([^{}]*)\}/g, "$1")
          .replace(/^.*=>\s*/, "")
          .replace(/\/{2,}/g, "/")
          .trim()
      : rawPath;
    if (!path) continue;
    const isBinary = addStr === "-" || delStr === "-";
    entries.set(path, {
      additions: isBinary ? undefined : Number.parseInt(addStr, 10) || 0,
      deletions: isBinary ? undefined : Number.parseInt(delStr, 10) || 0,
    });
  }
  return entries;
}

function locFromNumstat(
  path: string,
  unstagedNumstat: Map<string, NumstatEntry>,
  stagedNumstat: Map<string, NumstatEntry>,
): { additions?: number; deletions?: number } {
  const u = unstagedNumstat.get(path);
  const st = stagedNumstat.get(path);
  if (!u && !st) return {};
  const uBin = u !== undefined && u.additions === undefined;
  const sBin = st !== undefined && st.additions === undefined;
  if (uBin || sBin) return { additions: undefined, deletions: undefined };
  return {
    additions: (u?.additions ?? 0) + (st?.additions ?? 0),
    deletions: (u?.deletions ?? 0) + (st?.deletions ?? 0),
  };
}

export async function getStatus(
  repoPath: string,
  options?: GitStatusOptions,
): Promise<GitStatus> {
  const mode = normalizeStatusMode(options);
  const flags = statusModeFlags(mode);
  const [fileTree, readme, packageSummary, environmentWarnings, fallbackBranch] = await Promise.all([
    flags.includeTree ? collectFileTree(repoPath).catch(() => []) : Promise.resolve([]),
    flags.includeReadme ? readReadme(repoPath) : Promise.resolve(""),
    flags.includePackage ? readPackageSummary(repoPath) : Promise.resolve(""),
    flags.includeEnvironment ? collectEnvironmentWarnings(repoPath) : Promise.resolve([]),
    readBranchNameFromGitFiles(repoPath),
  ]);
  async function buildFallbackStatus(): Promise<GitStatus> {
    const fallbackIntelligence = flags.includeIntelligence
      ? await collectStatusIntelligence(repoPath, {
          files: fileTree,
          trackedFiles: fileTree,
        })
      : { secretWarnings: [], testCommands: [] };
    return {
      ...EMPTY_STATUS,
      branch: fallbackBranch,
      fileTree,
      readme,
      packageSummary,
      environmentWarnings,
      ...fallbackIntelligence,
    };
  }

  if (!(await isGitRepo(repoPath))) return buildFallbackStatus();
  try {
    const g = git(repoPath);
    const s = await g.status();
    const [diff, stagedDiff, unstagedNumstatRaw, stagedNumstatRaw] = await Promise.all([
      flags.includeDiff ? g.diff().catch(() => "") : Promise.resolve(""),
      flags.includeDiff ? g.diff(["--staged"]).catch(() => "") : Promise.resolve(""),
      // Skip per-file LOC in lite mode — LocalChangesPanel doesn't need it
      // and we want that path to stay snappy.
      flags.includeDiff
        ? g.raw(["diff", "--numstat", "HEAD"]).catch(() => "")
        : Promise.resolve(""),
      flags.includeDiff
        ? g.raw(["diff", "--cached", "--numstat"]).catch(() => "")
        : Promise.resolve(""),
    ]);
    const unstagedNumstat = parseNumstat(unstagedNumstatRaw);
    const stagedNumstat = parseNumstat(stagedNumstatRaw);
    const locFor = (path: string) =>
      locFromNumstat(path, unstagedNumstat, stagedNumstat);
    const files: GitFile[] = [
      ...s.created.map((p) => ({ path: p, status: "A" as const, staged: true, ...locFor(p) })),
      ...s.modified.map((p) => ({ path: p, status: "M" as const, staged: false, ...locFor(p) })),
      ...s.deleted.map((p) => ({ path: p, status: "D" as const, staged: false, ...locFor(p) })),
      ...s.renamed.map((r) => ({ path: r.to, status: "R" as const, staged: false, ...locFor(r.to) })),
      // Untracked files don't appear in HEAD numstat — leave LOC undefined so
      // the UI renders the `—` fallback.
      ...s.not_added.map((p) => ({ path: p, status: "?" as const, staged: false })),
      ...s.conflicted.map((p) => ({ path: p, status: "U" as const, staged: false, ...locFor(p) })),
      ...s.staged.map((p) => ({ path: p, status: "M" as const, staged: true, ...locFor(p) })),
    ];
    const statusIntelligence = flags.includeIntelligence
      ? await collectStatusIntelligence(repoPath, {
          stagedDiff,
          unstagedDiff: diff,
          files,
          trackedFiles: fileTree,
        })
      : { secretWarnings: [], testCommands: [] };
    return {
      files,
      branch: s.current ?? "HEAD",
      ahead: s.ahead,
      behind: s.behind,
      diff,
      stagedDiff,
      fileTree,
      readme,
      packageSummary,
      environmentWarnings,
      ...statusIntelligence,
    };
  } catch {
    return buildFallbackStatus();
  }
}

export async function showCommit(repoPath: string, hash: string): Promise<string> {
  if (!isSafeGitRef(hash)) return "";
  const fallback = await readCommitSummaryFromGitFiles(repoPath, hash);
  if (!(await isGitRepo(repoPath))) return fallback;
  try {
    const detail = await git(repoPath).show([hash]);
    return detail.trim() || fallback;
  } catch {
    return fallback;
  }
}

export interface CommitStatFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  status?: string;
  from?: string;
}

export interface CommitStat {
  hash: string;
  files: CommitStatFile[];
  insertions: number;
  deletions: number;
  changed: number;
  isRoot: boolean;
}

const EMPTY_COMMIT_STAT: CommitStat = {
  hash: "",
  files: [],
  insertions: 0,
  deletions: 0,
  changed: 0,
  isRoot: false,
};

function countTextLines(body: Buffer): number {
  if (body.length === 0 || isBinaryBuffer(body)) return 0;
  const text = body.toString("utf8");
  if (!text) return 0;
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized ? normalized.split(/\r\n|\n|\r/).length : 0;
}

function splitTextLines(body: Buffer): string[] {
  const lines = body.toString("utf8").split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function changedLineCounts(
  beforeLines: string[],
  afterLines: string[],
): { additions: number; deletions: number } {
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] ===
      afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeMiddle = beforeLines.length - prefix - suffix;
  const afterMiddle = afterLines.length - prefix - suffix;
  if (beforeMiddle <= 0 || afterMiddle <= 0) {
    return {
      additions: Math.max(0, afterMiddle),
      deletions: Math.max(0, beforeMiddle),
    };
  }

  // Exact enough for normal source files, bounded so a huge generated file
  // cannot freeze the utility process when git itself is unavailable.
  if (beforeMiddle * afterMiddle > 400_000) {
    return { additions: afterMiddle, deletions: beforeMiddle };
  }

  let previous = new Uint32Array(afterMiddle + 1);
  let current = new Uint32Array(afterMiddle + 1);
  for (let i = 1; i <= beforeMiddle; i += 1) {
    const before = beforeLines[prefix + i - 1];
    for (let j = 1; j <= afterMiddle; j += 1) {
      current[j] = before === afterLines[prefix + j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }

  const common = previous[afterMiddle];
  return {
    additions: afterMiddle - common,
    deletions: beforeMiddle - common,
  };
}

async function looseBlobLineCount(
  repoPath: string,
  hash: string,
): Promise<{ lines: number; binary: boolean }> {
  const object = await readGitObject(repoPath, hash);
  if (object?.type !== "blob") return { lines: 0, binary: false };
  const binary = isBinaryBuffer(object.body);
  return { lines: binary ? 0 : countTextLines(object.body), binary };
}

async function looseModifiedLineCounts(
  repoPath: string,
  beforeHash: string,
  afterHash: string,
): Promise<{ additions: number; deletions: number; binary: boolean }> {
  const [before, after] = await Promise.all([
    readGitObject(repoPath, beforeHash),
    readGitObject(repoPath, afterHash),
  ]);
  if (before?.type !== "blob" || after?.type !== "blob") {
    return { additions: 0, deletions: 0, binary: false };
  }
  const binary = isBinaryBuffer(before.body) || isBinaryBuffer(after.body);
  if (binary) return { additions: 0, deletions: 0, binary: true };
  return { ...changedLineCounts(splitTextLines(before.body), splitTextLines(after.body)), binary: false };
}

async function buildLooseCommitStatFile(
  repoPath: string,
  status: CommitStatFile["status"],
  path: string,
  before?: TreeEntrySummary,
  after?: TreeEntrySummary,
): Promise<CommitStatFile> {
  if (status === "A" && after) {
    const { lines, binary } = await looseBlobLineCount(repoPath, after.hash);
    return { path, insertions: lines, deletions: 0, binary, status };
  }
  if (status === "D" && before) {
    const { lines, binary } = await looseBlobLineCount(repoPath, before.hash);
    return { path, insertions: 0, deletions: lines, binary, status };
  }
  if (before && after) {
    const counts = await looseModifiedLineCounts(repoPath, before.hash, after.hash);
    return {
      path,
      insertions: counts.additions,
      deletions: counts.deletions,
      binary: counts.binary,
      status,
    };
  }
  return { path, insertions: 0, deletions: 0, binary: false, status };
}

async function getCommitStatFromLooseGitObjects(
  repoPath: string,
  hash: string,
): Promise<CommitStat> {
  const expandedHash = await expandCommitHashFromGitFiles(repoPath, hash);
  if (!expandedHash) return { ...EMPTY_COMMIT_STAT, hash };
  const commit = await readCommitObjectSummary(repoPath, expandedHash);
  if (!commit) return { ...EMPTY_COMMIT_STAT, hash: expandedHash };

  const currentEntries = await readTreeEntriesFromLooseObjects(repoPath, commit.tree);
  const parent = commit.parents[0]
    ? await readCommitObjectSummary(repoPath, commit.parents[0])
    : null;
  const parentEntries = parent
    ? await readTreeEntriesFromLooseObjects(repoPath, parent.tree)
    : new Map<string, TreeEntrySummary>();

  const paths = Array.from(
    new Set([...parentEntries.keys(), ...currentEntries.keys()]),
  ).sort((a, b) => a.localeCompare(b));

  const files: CommitStatFile[] = [];
  for (const path of paths) {
    const before = parentEntries.get(path);
    const after = currentEntries.get(path);
    if (!before && after) {
      files.push(await buildLooseCommitStatFile(repoPath, "A", path, before, after));
    } else if (before && !after) {
      files.push(await buildLooseCommitStatFile(repoPath, "D", path, before, after));
    } else if (before && after && (before.hash !== after.hash || before.mode !== after.mode)) {
      files.push(await buildLooseCommitStatFile(repoPath, "M", path, before, after));
    }
  }

  return {
    hash: expandedHash,
    files,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changed: files.length,
    isRoot: commit.parents.length === 0,
  };
}

export async function getCommitStat(
  repoPath: string,
  hash: string,
): Promise<CommitStat> {
  if (!isSafeGitRef(hash)) return EMPTY_COMMIT_STAT;
  const fallback = await getCommitStatFromLooseGitObjects(repoPath, hash).catch(() => ({
    ...EMPTY_COMMIT_STAT,
    hash,
  }));
  if (!(await isGitRepo(repoPath))) return fallback;
  const repo = git(repoPath);

  // Detect whether the commit has a parent. Root commits can't use `<hash>~1`.
  let isRoot = false;
  try {
    await repo.raw(["rev-parse", `${hash}^`]);
  } catch {
    isRoot = true;
  }

  const args = isRoot
    ? ["--name-status", "--root", `${hash}^@..${hash}`]
    : ["--name-status", `${hash}~1`, hash];

  try {
    const [summary, numstatRaw] = await Promise.all([
      repo.diffSummary(args),
      isRoot
        ? repo.raw(["diff-tree", "--numstat", "--root", "--no-commit-id", "-r", hash])
        : repo.raw(["diff", "--numstat", `${hash}~1`, hash]),
    ]);
    const numstat = parseNumstat(numstatRaw);
    const files: CommitStatFile[] = summary.files.map((entry) => {
      if ("binary" in entry && entry.binary) {
        return {
          path: entry.file,
          insertions: 0,
          deletions: 0,
          binary: true,
        };
      }
      const textOrNameStatus = entry as typeof entry & {
        insertions?: number;
        deletions?: number;
        status?: string;
        from?: string;
      };
      const counts =
        numstat.get(textOrNameStatus.file) ??
        (textOrNameStatus.from ? numstat.get(textOrNameStatus.from) : undefined);
      const binary = counts !== undefined && counts.additions === undefined;
      return {
        path: textOrNameStatus.file,
        insertions: counts?.additions ?? textOrNameStatus.insertions ?? 0,
        deletions: counts?.deletions ?? textOrNameStatus.deletions ?? 0,
        binary,
        status: textOrNameStatus.status,
        from: textOrNameStatus.from,
      };
    });
    const insertions = files.reduce((sum, file) => sum + file.insertions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const stat = {
      hash,
      files,
      insertions,
      deletions,
      changed: summary.changed,
      isRoot,
    };
    return files.length > 0 || fallback.files.length === 0 ? stat : fallback;
  } catch {
    return { ...fallback, isRoot: fallback.isRoot || isRoot };
  }
}

async function readCommitSummaryFromGitFiles(
  repoPath: string,
  hash: string,
): Promise<string> {
  const commits = await readCommitLogFromGitFiles(repoPath, 500);
  const commit = commits.find((item) => item.hash.startsWith(hash) || hash.startsWith(item.hash));
  if (!commit) return "";
  return [
    `commit ${commit.hash}`,
    `Author: ${commit.author}`,
    `Date: ${commit.date}`,
    "",
    `    ${commit.message}`,
    "",
    "Patch unavailable: the current runtime could not run git show for this commit.",
  ].join("\n");
}

export async function getLog(repoPath: string, maxCount = 100): Promise<Commit[]> {
  const requestedMaxCount = Number.isFinite(maxCount) ? Math.floor(maxCount) : 100;
  const boundedMaxCount = Math.max(1, Math.min(requestedMaxCount, 500));
  const fallbackLog = await readCommitLogFromGitFiles(repoPath, boundedMaxCount);
  if (!(await isGitRepo(repoPath))) return fallbackLog;
  try {
    const result = await git(repoPath).log({ maxCount: boundedMaxCount });
    const commits = result.all.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
    return commits.length > 0 ? commits : fallbackLog;
  } catch {
    return fallbackLog;
  }
}

export async function getStashes(repoPath: string): Promise<Stash[]> {
  if (!(await isGitRepo(repoPath))) return [];
  try {
    const result = await git(repoPath).stashList();
    return result.all.map((s) => ({
      ref: s.hash,
      message: s.message,
      date: s.date,
    }));
  } catch {
    return [];
  }
}

export async function getStashShow(repoPath: string, stashRef: string): Promise<string> {
  if (!(await isGitRepo(repoPath))) return "";
  if (!isSafeGitRef(stashRef)) return "";
  try {
    return await git(repoPath).stash(["show", "--include-untracked", "-p", stashRef]);
  } catch {
    try {
      return await git(repoPath).stash(["show", "-p", stashRef]);
    } catch {
      return "";
    }
  }
}

export async function getWorktrees(
  repoPath: string,
  options?: WorktreeOptions,
): Promise<WorktreeResult> {
  if (options && "mode" in options && options.mode === "summary-input") {
    return getWorktreeSummaryInput(repoPath, options);
  }
  return listWorktrees(repoPath);
}

async function listWorktrees(repoPath: string): Promise<Worktree[]> {
  if (!(await isGitRepo(repoPath))) return [];
  try {
    const raw = await git(repoPath).raw(["worktree", "list", "--porcelain"]);
    const parsed: ParsedWorktree[] = [];
    let current: Partial<ParsedWorktree> = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) parsed.push(current as ParsedWorktree);
        current = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.branch = current.branch || "(bare)";
      } else if (line.startsWith("locked")) {
        current.locked = true;
      } else if (line.startsWith("prunable")) {
        current.prunable = true;
      }
    }
    if (current.path) parsed.push(current as ParsedWorktree);

    const mainPath = parsed[0]?.path;
    return Promise.all(
      parsed.map(async (tree) => {
        const branch = tree.branch || "(detached)";
        const [status, divergence] = await Promise.all([
          getStatus(tree.path, { mode: "lite" }).catch(() => EMPTY_STATUS),
          branch && branch !== "(detached)" && branch !== "(bare)"
            ? getDivergence(tree.path, branch).catch(() => ({ ahead: 0, behind: 0 }))
            : Promise.resolve({ ahead: 0, behind: 0 }),
        ]);
        return {
          ...tree,
          branch,
          isMain: tree.path === mainPath,
          dirtyCount: status.files.length,
          ahead: divergence.ahead,
          behind: divergence.behind,
        };
      }),
    );
  } catch {
    return [];
  }
}

async function getWorktreeSummaryInput(
  repoPath: string,
  options: Extract<WorktreeOptions, { mode: "summary-input" }>,
): Promise<WorktreeSummaryInput> {
  const targetPath = options.targetPath || repoPath;
  if (!(await isGitRepo(targetPath))) {
    throw new Error("Not a git repository at " + targetPath);
  }

  const g = git(targetPath);
  const status = await getStatus(targetPath, { mode: "diff" });
  const [baseCandidates, worktreeCandidates] = await Promise.all([
    listCompareRefs(g).catch(() => []),
    listWorktrees(repoPath).catch(() => []),
  ]);
  const preferredBase =
    options.base && isSafeGitRef(options.base)
      ? options.base
      : await guessDefaultCompareBase(g, status.branch);
  const baseRef = await resolveCompareBase(g, preferredBase);
  const targetRef = "HEAD";
  const target = status.branch || nodePath.basename(targetPath);
  const [aheadBehind, diffStat, nameStatus, patch, uniqueRaw] = await Promise.all([
    g.raw(["rev-list", "--left-right", "--count", `${baseRef}...${targetRef}`]).catch(() => "0\t0"),
    g.raw(["diff", "--stat", `${baseRef}...${targetRef}`]).catch(() => ""),
    g.raw(["diff", "--name-status", `${baseRef}...${targetRef}`]).catch(() => ""),
    g.raw(["diff", "--find-renames", `${baseRef}...${targetRef}`]).catch(() => ""),
    g.raw(["log", "--oneline", "--decorate=no", "-20", `${baseRef}..${targetRef}`]).catch(() => ""),
  ]);
  const [behind, ahead] = aheadBehind.trim().split(/\s+/).map((value) => parseInt(value, 10) || 0);
  const changedFiles = Array.from(
    new Set([
      ...parseNameStatusPaths(nameStatus),
      ...status.files.map((file) => file.path),
    ]),
  );

  return {
    repoPath,
    targetPath,
    base: options.base || baseRef,
    target,
    baseRef,
    targetRef,
    branch: status.branch,
    ahead,
    behind,
    dirtyFiles: status.files.length,
    diffStat,
    nameStatus,
    patch: truncateText(patch, MAX_COMPARE_PATCH_CHARS),
    uncommittedDiff: truncateText([status.stagedDiff, status.diff].filter(Boolean).join("\n\n"), 8_000),
    uniqueCommits: uniqueRaw.split("\n").map((line) => line.trim()).filter(Boolean),
    changedFiles,
    baseCandidates,
    worktreeCandidates: worktreeCandidates.map((tree) => ({
      path: tree.path,
      branch: tree.branch,
      head: tree.head,
      isMain: tree.isMain,
    })),
  };
}

async function listCompareRefs(g: SimpleGit): Promise<string[]> {
  const raw = await g.raw([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  return Array.from(
    new Set(
      raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((ref) => !ref.endsWith("/HEAD"))
        .filter(isSafeGitRef),
    ),
  ).slice(0, 120);
}

async function guessDefaultCompareBase(
  g: SimpleGit,
  currentBranch: string,
): Promise<string> {
  const candidates = [
    "origin/main",
    "origin/master",
    "origin/develop",
    "main",
    "master",
    "develop",
    currentBranch ? `origin/${currentBranch}` : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await g.raw(["rev-parse", "--verify", "--quiet", candidate]);
      return candidate;
    } catch {
      // Try the next conventional base.
    }
  }
  return currentBranch || "HEAD";
}

async function resolveCompareBase(g: SimpleGit, preferred: string): Promise<string> {
  const candidates = Array.from(
    new Set([
      preferred,
      preferred.startsWith("origin/") ? preferred : `origin/${preferred}`,
      "origin/main",
      "origin/master",
      "main",
      "master",
      "HEAD",
    ].filter(Boolean)),
  );
  for (const candidate of candidates) {
    try {
      await g.raw(["rev-parse", "--verify", "--quiet", candidate]);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return "HEAD";
}

function parseNameStatusPaths(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim().split(/\s+/).slice(1).pop() ?? "")
    .filter(Boolean);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

export async function readRepoFile(
  repoPath: string,
  filePath: string,
  options: RepoFileReadOptions = {},
): Promise<RepoFileContent> {
  if (!(await isInspectableWorkspaceRoot(repoPath))) {
    throw new Error("File inspection requires a local workspace root.");
  }
  const safePath = normalizeRepoRelativePath(filePath);
  assertInspectableRepoFilePath(safePath);
  const maxBytes = boundedInspectBytes(options.maxBytes);
  const ref = options.ref?.trim();
  if (ref) {
    return readRepoFileFromRef(repoPath, safePath, ref, maxBytes);
  }
  return readRepoFileFromWorkingTree(repoPath, safePath, maxBytes);
}

async function readRepoFileFromWorkingTree(
  repoPath: string,
  safePath: string,
  maxBytes: number,
): Promise<RepoFileContent> {
  const root = nodePath.resolve(repoPath);
  const absolutePath = nodePath.resolve(root, safePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${nodePath.sep}`)) {
    throw new Error("File path escapes the repository root.");
  }

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error("Requested path is not a file.");
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(root),
    fs.realpath(absolutePath),
  ]);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${nodePath.sep}`)) {
    throw new Error("File path escapes the repository root.");
  }

  const handle = await fs.open(absolutePath, "r");
  try {
    const readLength = Math.min(stat.size, maxBytes + 1);
    const buffer = Buffer.alloc(readLength);
    const { bytesRead } = await handle.read(buffer, 0, readLength, 0);
    const payload = buffer.subarray(0, Math.min(bytesRead, maxBytes));
    const binary = isBinaryBuffer(payload);
    return {
      path: safePath,
      content: binary ? "" : payload.toString("utf8"),
      size: stat.size,
      truncated: stat.size > maxBytes || bytesRead > maxBytes,
      binary,
      encoding: binary ? "binary" : "utf8",
      source: "working-tree",
      language: languageFromPath(safePath),
    };
  } finally {
    await handle.close();
  }
}

async function readRepoFileFromRef(
  repoPath: string,
  safePath: string,
  ref: string,
  maxBytes: number,
): Promise<RepoFileContent> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error("Git ref inspection requires a git repository.");
  }
  if (!isSafeGitRef(ref)) {
    throw new Error("Unsafe git ref for file inspection.");
  }

  const objectSpec = `${ref}:${safePath}`;
  const g = git(repoPath);
  const sizeRaw = await g.raw(["cat-file", "-s", objectSpec]).catch(() => "");
  const size = Number.parseInt(sizeRaw.trim(), 10);
  if (Number.isFinite(size) && size > maxBytes) {
    return {
      path: safePath,
      ref,
      content: "",
      size,
      truncated: true,
      binary: false,
      encoding: "utf8",
      source: "git-ref",
      language: languageFromPath(safePath),
    };
  }

  const raw = await g.raw(["show", objectSpec]);
  const buffer = Buffer.from(raw, "utf8");
  const payload = buffer.subarray(0, maxBytes);
  const binary = isBinaryBuffer(payload);
  return {
    path: safePath,
    ref,
    content: binary ? "" : payload.toString("utf8"),
    size: Number.isFinite(size) ? size : buffer.length,
    truncated: buffer.length > maxBytes,
    binary,
    encoding: binary ? "binary" : "utf8",
    source: "git-ref",
    language: languageFromPath(safePath),
  };
}

function normalizeRepoRelativePath(filePath: string): string {
  const withoutPrefix = filePath.trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  const normalized = nodePath.posix.normalize(withoutPrefix);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    nodePath.isAbsolute(withoutPrefix)
  ) {
    throw new Error("File path must be relative to the repository root.");
  }
  return normalized;
}

function assertInspectableRepoFilePath(safePath: string): void {
  const segments = safePath.split("/");
  if (segments.includes(".git")) {
    throw new Error("File inspection does not expose git internals.");
  }
  const filename = segments[segments.length - 1] ?? "";
  if (ENV_FILE_NAMES.has(filename)) {
    throw new Error("File inspection does not expose environment files.");
  }
}

function boundedInspectBytes(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return MAX_INSPECT_FILE_BYTES;
  return Math.max(1_024, Math.min(Math.floor(value), MAX_INSPECT_FILE_BYTES));
}

function isSafeGitRef(ref: string): boolean {
  if (!ref || ref.startsWith("-")) return false;
  if (/[\0\r\n]/.test(ref)) return false;
  if (ref.includes("..") || ref.includes("//") || ref.includes("\\") || ref.includes(":")) {
    return false;
  }
  if (ref.endsWith(".") || ref.endsWith(".lock")) return false;
  return /^[A-Za-z0-9_./@{}~^-]+$/.test(ref);
}

function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  if (buffer.length === 0) return false;
  let control = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) control += 1;
  }
  return control / buffer.length > 0.08;
}

function languageFromPath(filePath: string): string {
  const extension = nodePath.extname(filePath).slice(1).toLowerCase();
  if (!extension) return "";
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    sol: "solidity",
    md: "markdown",
    yml: "yaml",
  };
  return aliases[extension] ?? extension;
}

export async function getDivergence(repoPath: string, branch: string): Promise<Divergence> {
  if (!(await isGitRepo(repoPath))) return { ahead: 0, behind: 0 };
  if (!isSafeGitRef(branch)) return { ahead: 0, behind: 0 };
  try {
    const g = git(repoPath);
    const upstream = await getUpstreamRef(g, branch);
    if (!upstream) return { ahead: 0, behind: 0 };
    const out = await g.raw(["rev-list", "--left-right", "--count", `${branch}...${upstream}`]);
    const [ahead, behind] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function getUpstreamRef(g: SimpleGit, branch: string): Promise<string | null> {
  try {
    const upstream = await g.raw([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    const trimmed = upstream.trim();
    if (trimmed) return trimmed;
  } catch {
    // Fall through to the conventional origin/<branch> check.
  }

  const fallback = `origin/${branch}`;
  try {
    await g.raw(["rev-parse", "--verify", "--quiet", fallback]);
    return fallback;
  } catch {
    return null;
  }
}

export async function gitPush(repoPath: string, remote: string, branch: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error("Not a git repository at " + repoPath);
  }
  assertSafeRemoteAndBranch(remote, branch);
  await git(repoPath).push(remote, branch);
}

export async function gitPull(repoPath: string, remote: string, branch: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error("Not a git repository at " + repoPath);
  }
  assertSafeRemoteAndBranch(remote, branch);
  await git(repoPath).pull(remote, branch);
}

export async function gitCommit(repoPath: string, message: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error("Not a git repository at " + repoPath);
  }
  if (!message.trim()) throw new Error("Commit message cannot be empty.");
  if (message.length > 10_000) throw new Error("Commit message is too large.");
  await git(repoPath).commit(message);
}

export async function stashPop(repoPath: string, stashRef: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error("Not a git repository at " + repoPath);
  }
  if (!isSafeGitRef(stashRef)) throw new Error("Unsafe stash ref.");
  await git(repoPath).stash(["pop", stashRef]);
}

export async function stashDrop(repoPath: string, stashRef: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error("Not a git repository at " + repoPath);
  }
  if (!isSafeGitRef(stashRef)) throw new Error("Unsafe stash ref.");
  await git(repoPath).stash(["drop", stashRef]);
}

function assertSafeRemoteAndBranch(remote: string, branch: string): void {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(remote) || remote.startsWith("-")) {
    throw new Error("Unsafe git remote name.");
  }
  if (!isSafeGitRef(branch)) {
    throw new Error("Unsafe git branch name.");
  }
}
