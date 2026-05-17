import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import zlib from "node:zlib";

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = (request, parent, isMain, options) => {
  try {
    return originalResolveFilename.call(Module, request, parent, isMain, options);
  } catch (error) {
    if (request.startsWith(".") && parent?.filename) {
      const candidate = path.resolve(path.dirname(parent.filename), request);
      if (fs.existsSync(`${candidate}.ts`)) return `${candidate}.ts`;
    }
    throw error;
  }
};

Module._extensions[".ts"] = (moduleInstance, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  moduleInstance._compile(compiled.outputText, filename);
};

function loadGitOps() {
  const filename = path.resolve("electron/lib/git-ops.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const moduleInstance = new Module(filename);
  moduleInstance.filename = filename;
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleInstance._compile(compiled.outputText, filename);
  return moduleInstance.exports;
}

async function writeFixture(root) {
  await fsp.mkdir(path.join(root, ".git", "logs", "refs", "heads"), { recursive: true });
  await fsp.mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  await fsp.writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\n");
  await fsp.writeFile(path.join(root, "README.md"), "# Fixture Repo\n\nA local backend smoke fixture.\n");
  await fsp.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { test: "vitest" } }, null, 2),
  );
  await fsp.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n");
  await fsp.writeFile(path.join(root, ".env"), "SECRET_TOKEN=abc123\nPORT=5173\n");
  const objectIds = await writeGitObjects(root);
  const first = objectIds.firstCommit;
  const second = objectIds.secondCommit;
  const zero = "0000000000000000000000000000000000000000";
  const now = Math.floor(Date.now() / 1000);
  const log = [
    `${zero} ${first} Test User <test@example.com> ${now - 60} +0000\tcommit: initial fixture`,
    `${first} ${second} Test User <test@example.com> ${now} +0000\tcommit: add smoke target`,
  ].join("\n");
  await fsp.writeFile(path.join(root, ".git", "logs", "refs", "heads", "main"), `${log}\n`);
  await fsp.writeFile(path.join(root, ".git", "logs", "HEAD"), `${log}\n`);
  return objectIds;
}

async function writeGitObjects(root) {
  const now = Math.floor(Date.now() / 1000);
  const readme = await writeObject(root, "blob", Buffer.from("# Fixture Repo\n\nA local backend smoke fixture.\n"));
  const pkg = await writeObject(root, "blob", Buffer.from(JSON.stringify({ name: "fixture", scripts: { test: "vitest" } }, null, 2)));
  const indexV1 = await writeObject(root, "blob", Buffer.from("export const value = 1;\n"));
  const indexV2 = await writeObject(root, "blob", Buffer.from("export const value = 2;\n"));
  const extra = await writeObject(root, "blob", Buffer.from("export const extra = true;\n"));

  const srcTreeV1 = await writeTree(root, [["100644", "index.ts", indexV1]]);
  const srcTreeV2 = await writeTree(root, [
    ["100644", "extra.ts", extra],
    ["100644", "index.ts", indexV2],
  ]);
  const rootTreeV1 = await writeTree(root, [
    ["100644", "README.md", readme],
    ["100644", "package.json", pkg],
    ["40000", "src", srcTreeV1],
  ]);
  const rootTreeV2 = await writeTree(root, [
    ["100644", "README.md", readme],
    ["100644", "package.json", pkg],
    ["40000", "src", srcTreeV2],
  ]);
  const firstCommit = await writeObject(root, "commit", Buffer.from([
    `tree ${rootTreeV1}`,
    `author Test User <test@example.com> ${now - 60} +0000`,
    `committer Test User <test@example.com> ${now - 60} +0000`,
    "",
    "initial fixture",
    "",
  ].join("\n")));
  const secondCommit = await writeObject(root, "commit", Buffer.from([
    `tree ${rootTreeV2}`,
    `parent ${firstCommit}`,
    `author Test User <test@example.com> ${now} +0000`,
    `committer Test User <test@example.com> ${now} +0000`,
    "",
    "add smoke target",
    "",
  ].join("\n")));
  return { firstCommit, secondCommit };
}

async function writeTree(root, entries) {
  const body = Buffer.concat(entries.map(([mode, name, hash]) =>
    Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(hash, "hex")]),
  ));
  return writeObject(root, "tree", body);
}

async function writeObject(root, type, body) {
  const payload = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
  const hash = crypto.createHash("sha1").update(payload).digest("hex");
  const dir = path.join(root, ".git", "objects", hash.slice(0, 2));
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, hash.slice(2)), zlib.deflateSync(payload));
  return hash;
}

async function expectReject(label, action) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label} should have been rejected`);
}

const root = await fsp.mkdtemp(path.join(os.tmpdir(), "overcode-fixture-"));
try {
  const objectIds = await writeFixture(root);
  const gitOps = loadGitOps();
  const candidates = await gitOps.scanWorkspaceCandidates([root]);
  const repos = await gitOps.scanRepos([root]);
  const status = await gitOps.getStatus(root);
  const log = await gitOps.getLog(root, 10);
  const commitDetail = await gitOps.showCommit(root, log[0]?.hash ?? "");
  const commitStat = await gitOps.getCommitStat(root, objectIds.secondCommit);
  const file = await gitOps.readRepoFile(root, "src/index.ts");
  await expectReject("env file read", () => gitOps.readRepoFile(root, ".env"));
  await expectReject("git internals read", () => gitOps.readRepoFile(root, ".git/HEAD"));
  await expectReject("path escape read", () => gitOps.readRepoFile(root, "../package.json"));

  if (candidates.length !== 1) throw new Error("Fixture candidate was not detected");
  if (repos.length !== 1) throw new Error("Fixture repo was not detected");
  if (repos[0].platform !== "github") throw new Error("Fixture .github marker was not classified");
  if (status.branch !== "main") throw new Error(`Expected branch main, got ${status.branch}`);
  if (!status.readme.includes("Fixture Repo")) throw new Error("README fallback missing");
  if (!status.packageSummary.includes("scripts: test")) throw new Error("package summary missing");
  if (log.length !== 2) throw new Error(`Expected 2 fallback commits, got ${log.length}`);
  if (!commitDetail.includes(log[0].hash)) throw new Error("commit detail fallback missing");
  if (commitStat.changed !== 2) {
    throw new Error(`Expected 2 fallback commit-stat file changes, got ${commitStat.changed}`);
  }
  if (file.content.trim() !== "export const value = 1;") throw new Error("readRepoFile returned wrong content");

  console.log(JSON.stringify({
    candidateCount: candidates.length,
    repo: repos[0],
    branch: status.branch,
    fileTreeCount: status.fileTree.length,
    commitCount: log.length,
    commitDetailFallback: true,
    commitStatChanged: commitStat.changed,
    guardedReads: true,
  }, null, 2));
} finally {
  await fsp.rm(root, { recursive: true, force: true });
}
