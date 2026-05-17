import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

const DEFAULT_PATHS = ["~/projects", "~/Desktop/persona", "~/Desktop"];
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

const scanPaths = process.argv.slice(2);
const repositories = await moduleInstance.exports.scanRepos(
  scanPaths.length > 0 ? scanPaths : DEFAULT_PATHS,
);

console.log(
  JSON.stringify(
    {
      total: repositories.length,
      github: repositories.filter((repo) => repo.platform === "github").length,
      gitlab: repositories.filter((repo) => repo.platform === "gitlab").length,
      local: repositories.filter((repo) => repo.platform === "local").length,
      sample: repositories.slice(0, 12).map((repo) => ({
        name: repo.name,
        platform: repo.platform,
        hasRemote: Boolean(repo.remote_url),
        path: repo.local_path,
      })),
    },
    null,
    2,
  ),
);

process.exit(repositories.length > 0 ? 0 : 1);
