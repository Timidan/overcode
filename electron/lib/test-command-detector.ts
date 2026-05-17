import fs from "node:fs/promises";
import nodePath from "node:path";

export type TestCommandKind =
  | "test"
  | "lint"
  | "build"
  | "typecheck"
  | "format"
  | "dev"
  | "other";

export type TestCommandConfidence = "low" | "medium" | "high";

export interface TestCommandSuggestion {
  command: string;
  kind: TestCommandKind;
  confidence: TestCommandConfidence;
  reason: string;
  paths: string[];
}

interface MarkerFile {
  name: string;
  path: string;
}

interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

type SuggestionDraft = TestCommandSuggestion & { rank: number };

const TOP_LEVEL_MARKERS = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
  "foundry.toml",
  "hardhat.config.ts",
  "hardhat.config.js",
  "hardhat.config.mjs",
  "hardhat.config.cjs",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Makefile",
  "makefile",
];
const MAX_MARKER_BYTES = 256 * 1024;

const PACKAGE_SCRIPT_KIND_HINTS: Array<[TestCommandKind, string[]]> = [
  ["test", ["test", "test:unit", "unit", "check:test"]],
  ["lint", ["lint", "lint:check", "eslint", "check:lint"]],
  ["build", ["build", "compile", "dist", "package"]],
  ["typecheck", ["typecheck", "type-check", "tsc", "check:types"]],
  ["format", ["format", "fmt", "prettier", "format:check"]],
  ["dev", ["dev", "start", "serve"]],
];

const MAKE_TARGET_KIND_HINTS: Array<[TestCommandKind, string[]]> = [
  ["test", ["test", "tests", "check"]],
  ["lint", ["lint", "clippy"]],
  ["build", ["build", "compile"]],
  ["typecheck", ["typecheck", "type-check", "mypy", "check-types"]],
  ["format", ["format", "fmt"]],
  ["dev", ["dev", "serve", "run"]],
];

export async function detectTestCommands(
  repoPath: string,
): Promise<TestCommandSuggestion[]> {
  const markers = await readTopLevelMarkers(repoPath);
  const markerByName = new Map(markers.map((marker) => [marker.name, marker]));
  const suggestions: SuggestionDraft[] = [];

  const packageJsonMarker = markerByName.get("package.json");
  const packageJson = packageJsonMarker
    ? await readJson<PackageJson>(packageJsonMarker.path)
    : null;
  if (packageJsonMarker && packageJson) {
    suggestions.push(
      ...detectPackageScripts(
        packageJson,
        packageJsonMarker,
        detectPackageManager(markerByName),
      ),
    );
  }

  const hardhatMarker = findFirstMarker(markerByName, [
    "hardhat.config.ts",
    "hardhat.config.js",
    "hardhat.config.mjs",
    "hardhat.config.cjs",
  ]);
  if (hardhatMarker) {
    suggestions.push(...detectHardhatCommands(hardhatMarker, packageJson));
  }

  const foundryMarker = markerByName.get("foundry.toml");
  if (foundryMarker) {
    suggestions.push(...detectFoundryCommands(foundryMarker));
  }

  const cargoMarker = markerByName.get("Cargo.toml");
  if (cargoMarker) {
    suggestions.push(...detectCargoCommands(cargoMarker));
  }

  const pyprojectMarker = markerByName.get("pyproject.toml");
  if (pyprojectMarker) {
    const pyproject = await readTextOrEmpty(pyprojectMarker.path);
    suggestions.push(...detectPythonCommands(pyprojectMarker, pyproject));
  }

  const goModMarker = markerByName.get("go.mod");
  if (goModMarker) {
    suggestions.push(...detectGoCommands(goModMarker));
  }

  const makefileMarker = markerByName.get("Makefile") ?? markerByName.get("makefile");
  if (makefileMarker) {
    const makefile = await readTextOrEmpty(makefileMarker.path);
    suggestions.push(...detectMakeCommands(makefileMarker, makefile));
  }

  return dedupeAndSort(suggestions);
}

async function readTopLevelMarkers(repoPath: string): Promise<MarkerFile[]> {
  const entries = await fs.readdir(repoPath, { withFileTypes: true });
  const entryNames = new Set(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );

  return TOP_LEVEL_MARKERS.filter((name) => entryNames.has(name)).map((name) => ({
    name,
    path: nodePath.join(repoPath, name),
  }));
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readText(filePath)) as T;
  } catch {
    return null;
  }
}

async function readText(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_MARKER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readTextOrEmpty(filePath: string): Promise<string> {
  try {
    return await readText(filePath);
  } catch {
    return "";
  }
}

function detectPackageManager(
  markerByName: Map<string, MarkerFile>,
): {
  name: "pnpm" | "yarn" | "bun" | "npm";
  reason: string;
  paths: string[];
} {
  if (markerByName.has("pnpm-lock.yaml")) {
    return {
      name: "pnpm",
      reason: "pnpm-lock.yaml indicates pnpm is the package manager.",
      paths: [markerByName.get("pnpm-lock.yaml")?.path ?? ""],
    };
  }
  if (markerByName.has("yarn.lock")) {
    return {
      name: "yarn",
      reason: "yarn.lock indicates Yarn is the package manager.",
      paths: [markerByName.get("yarn.lock")?.path ?? ""],
    };
  }
  if (markerByName.has("bun.lockb") || markerByName.has("bun.lock")) {
    const marker = markerByName.get("bun.lockb") ?? markerByName.get("bun.lock");
    return {
      name: "bun",
      reason: `${marker?.name ?? "Bun lockfile"} indicates Bun is the package manager.`,
      paths: marker ? [marker.path] : [],
    };
  }
  if (markerByName.has("package-lock.json")) {
    return {
      name: "npm",
      reason: "package-lock.json indicates npm is the package manager.",
      paths: [markerByName.get("package-lock.json")?.path ?? ""],
    };
  }
  return {
    name: "npm",
    reason: "package.json was found without a lockfile, so npm is the conservative default.",
    paths: [],
  };
}

function detectPackageScripts(
  packageJson: PackageJson,
  packageJsonMarker: MarkerFile,
  packageManager: ReturnType<typeof detectPackageManager>,
): SuggestionDraft[] {
  const scripts = packageJson.scripts ?? {};
  const suggestions: SuggestionDraft[] = [];
  const packagePaths = [packageJsonMarker.path, ...packageManager.paths].filter(Boolean);

  for (const [kind, scriptNames] of PACKAGE_SCRIPT_KIND_HINTS) {
    const scriptName = scriptNames.find((name) => typeof scripts[name] === "string");
    if (!scriptName) continue;

    suggestions.push(
      makeSuggestion({
        command: packageRunCommand(packageManager.name, scriptName),
        kind,
        confidence: "high",
        reason: `package.json defines a "${scriptName}" script. ${packageManager.reason}`,
        paths: packagePaths,
        rank: 100,
      }),
    );
  }

  return suggestions;
}

function packageRunCommand(
  packageManager: "pnpm" | "yarn" | "bun" | "npm",
  scriptName: string,
): string {
  if (packageManager === "npm") return `npm run ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `${packageManager} ${scriptName}`;
}

function detectHardhatCommands(
  hardhatMarker: MarkerFile,
  packageJson: PackageJson | null,
): SuggestionDraft[] {
  const hasHardhatDependency = hasDependency(packageJson, "hardhat");
  const confidence = hasHardhatDependency ? "high" : "medium";
  const reason = hasHardhatDependency
    ? "Hardhat config and hardhat dependency were found."
    : "Hardhat config was found.";

  return [
    makeSuggestion({
      command: "npx hardhat test",
      kind: "test",
      confidence,
      reason,
      paths: [hardhatMarker.path],
      rank: 80,
    }),
    makeSuggestion({
      command: "npx hardhat compile",
      kind: "build",
      confidence,
      reason,
      paths: [hardhatMarker.path],
      rank: 70,
    }),
  ];
}

function detectFoundryCommands(foundryMarker: MarkerFile): SuggestionDraft[] {
  return [
    makeSuggestion({
      command: "forge test",
      kind: "test",
      confidence: "high",
      reason: "foundry.toml identifies a Foundry project.",
      paths: [foundryMarker.path],
      rank: 90,
    }),
    makeSuggestion({
      command: "forge build",
      kind: "build",
      confidence: "high",
      reason: "foundry.toml identifies a Foundry project.",
      paths: [foundryMarker.path],
      rank: 80,
    }),
    makeSuggestion({
      command: "forge fmt --check",
      kind: "format",
      confidence: "medium",
      reason: "Foundry projects commonly use forge fmt for Solidity formatting.",
      paths: [foundryMarker.path],
      rank: 60,
    }),
  ];
}

function detectCargoCommands(cargoMarker: MarkerFile): SuggestionDraft[] {
  return [
    makeSuggestion({
      command: "cargo test",
      kind: "test",
      confidence: "high",
      reason: "Cargo.toml identifies a Rust crate or workspace.",
      paths: [cargoMarker.path],
      rank: 90,
    }),
    makeSuggestion({
      command: "cargo build",
      kind: "build",
      confidence: "high",
      reason: "Cargo.toml identifies a Rust crate or workspace.",
      paths: [cargoMarker.path],
      rank: 80,
    }),
    makeSuggestion({
      command: "cargo clippy --all-targets --all-features",
      kind: "lint",
      confidence: "medium",
      reason: "Rust projects commonly use clippy for linting.",
      paths: [cargoMarker.path],
      rank: 60,
    }),
    makeSuggestion({
      command: "cargo fmt --check",
      kind: "format",
      confidence: "medium",
      reason: "Rust projects commonly use rustfmt via cargo fmt.",
      paths: [cargoMarker.path],
      rank: 60,
    }),
  ];
}

function detectPythonCommands(
  pyprojectMarker: MarkerFile,
  pyproject: string,
): SuggestionDraft[] {
  const suggestions: SuggestionDraft[] = [];
  const hasPytestConfig = hasTomlTable(pyproject, "tool.pytest.ini_options");
  const hasRuffConfig = hasTomlTable(pyproject, "tool.ruff");
  const hasMypyConfig = hasTomlTable(pyproject, "tool.mypy");
  const hasBlackConfig = hasTomlTable(pyproject, "tool.black");
  const hasBuildSystem = hasTomlTable(pyproject, "build-system");

  suggestions.push(
    makeSuggestion({
      command: "python -m pytest",
      kind: "test",
      confidence: hasPytestConfig ? "high" : "medium",
      reason: hasPytestConfig
        ? "pyproject.toml contains pytest configuration."
        : "pyproject.toml identifies a Python project.",
      paths: [pyprojectMarker.path],
      rank: hasPytestConfig ? 90 : 50,
    }),
  );

  if (hasRuffConfig) {
    suggestions.push(
      makeSuggestion({
        command: "python -m ruff check .",
        kind: "lint",
        confidence: "high",
        reason: "pyproject.toml contains Ruff configuration.",
        paths: [pyprojectMarker.path],
        rank: 80,
      }),
      makeSuggestion({
        command: "python -m ruff format --check .",
        kind: "format",
        confidence: "high",
        reason: "pyproject.toml contains Ruff configuration.",
        paths: [pyprojectMarker.path],
        rank: 70,
      }),
    );
  }

  if (hasMypyConfig) {
    suggestions.push(
      makeSuggestion({
        command: "python -m mypy .",
        kind: "typecheck",
        confidence: "high",
        reason: "pyproject.toml contains mypy configuration.",
        paths: [pyprojectMarker.path],
        rank: 80,
      }),
    );
  }

  if (hasBlackConfig) {
    suggestions.push(
      makeSuggestion({
        command: "python -m black --check .",
        kind: "format",
        confidence: "high",
        reason: "pyproject.toml contains Black configuration.",
        paths: [pyprojectMarker.path],
        rank: 70,
      }),
    );
  }

  if (hasBuildSystem) {
    suggestions.push(
      makeSuggestion({
        command: "python -m build",
        kind: "build",
        confidence: "medium",
        reason: "pyproject.toml contains a build-system table.",
        paths: [pyprojectMarker.path],
        rank: 50,
      }),
    );
  }

  return suggestions;
}

function detectGoCommands(goModMarker: MarkerFile): SuggestionDraft[] {
  return [
    makeSuggestion({
      command: "go test ./...",
      kind: "test",
      confidence: "high",
      reason: "go.mod identifies a Go module.",
      paths: [goModMarker.path],
      rank: 90,
    }),
    makeSuggestion({
      command: "go build ./...",
      kind: "build",
      confidence: "high",
      reason: "go.mod identifies a Go module.",
      paths: [goModMarker.path],
      rank: 80,
    }),
    makeSuggestion({
      command: "gofmt -w .",
      kind: "format",
      confidence: "medium",
      reason: "Go modules commonly use gofmt for formatting.",
      paths: [goModMarker.path],
      rank: 50,
    }),
  ];
}

function detectMakeCommands(
  makefileMarker: MarkerFile,
  makefile: string,
): SuggestionDraft[] {
  const targets = parseMakeTargets(makefile);
  const suggestions: SuggestionDraft[] = [];

  for (const [kind, targetNames] of MAKE_TARGET_KIND_HINTS) {
    const target = targetNames.find((name) => targets.has(name));
    if (!target) continue;

    suggestions.push(
      makeSuggestion({
        command: `make ${target}`,
        kind,
        confidence: "high",
        reason: `${makefileMarker.name} defines a "${target}" target.`,
        paths: [makefileMarker.path],
        rank: 100,
      }),
    );
  }

  return suggestions;
}

function parseMakeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const line of makefile.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+)\s*:(?![=])/.exec(line);
    if (match) targets.add(match[1]);
  }
  return targets;
}

function hasTomlTable(source: string, tableName: string): boolean {
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*\\[${escapedTableName}\\]\\s*$`, "m").test(source);
}

function hasDependency(packageJson: PackageJson | null, dependencyName: string): boolean {
  if (!packageJson) return false;
  return Boolean(
    packageJson.dependencies?.[dependencyName] ??
      packageJson.devDependencies?.[dependencyName],
  );
}

function findFirstMarker(
  markerByName: Map<string, MarkerFile>,
  names: string[],
): MarkerFile | undefined {
  for (const name of names) {
    const marker = markerByName.get(name);
    if (marker) return marker;
  }
  return undefined;
}

function makeSuggestion(input: SuggestionDraft): SuggestionDraft {
  return {
    ...input,
    paths: Array.from(new Set(input.paths.filter(Boolean))),
  };
}

function dedupeAndSort(suggestions: SuggestionDraft[]): TestCommandSuggestion[] {
  const bestByKey = new Map<string, SuggestionDraft>();

  for (const suggestion of suggestions) {
    const key = `${suggestion.kind}:${suggestion.command}`;
    const existing = bestByKey.get(key);
    if (!existing || scoreSuggestion(suggestion) > scoreSuggestion(existing)) {
      bestByKey.set(key, suggestion);
    }
  }

  return Array.from(bestByKey.values())
    .sort((left, right) => {
      const scoreDelta = scoreSuggestion(right) - scoreSuggestion(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.command.localeCompare(right.command);
    })
    .map(stripRank);
}

function stripRank(suggestion: SuggestionDraft): TestCommandSuggestion {
  return {
    command: suggestion.command,
    kind: suggestion.kind,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    paths: suggestion.paths,
  };
}

function scoreSuggestion(suggestion: SuggestionDraft): number {
  const confidenceScore: Record<TestCommandConfidence, number> = {
    high: 30,
    medium: 20,
    low: 10,
  };
  return suggestion.rank + confidenceScore[suggestion.confidence];
}
