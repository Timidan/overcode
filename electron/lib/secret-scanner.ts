import nodePath from "node:path";
import fs from "node:fs/promises";

const MAX_DIFF_CHARS = 240_000;
const MAX_FILES_TO_INSPECT = 80;
const MAX_FILE_BYTES = 64_000;
const MAX_WARNINGS = 80;

const ENV_FILE_RE = /(^|\/)\.env($|[./-][^/]*$)/i;
const PRIVATE_KEY_FILE_RE =
  /(^|\/)(id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|p8|p12))$/i;
const SECRET_FILE_RE = /(secret|credential|token|apikey|api-key|private-key)/i;

const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|refresh[_-]?token|bearer[_-]?token)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=:@$!%~-]{16,})["']?/gi;

const PROVIDER_PATTERNS: SecretPattern[] = [
  {
    kind: "github_token",
    title: "Possible GitHub token",
    severity: "high",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    kind: "aws_access_key",
    title: "Possible AWS access key",
    severity: "high",
    regex: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: "google_api_key",
    title: "Possible Google API key",
    severity: "high",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: "slack_token",
    title: "Possible Slack token",
    severity: "high",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g,
  },
  {
    kind: "stripe_secret_key",
    title: "Possible Stripe secret key",
    severity: "high",
    regex: /\bsk_(live|test)_[0-9A-Za-z]{20,}\b/g,
  },
  {
    kind: "jwt",
    title: "Possible JWT token",
    severity: "medium",
    regex: /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
  },
  {
    kind: "private_key",
    title: "Possible private key material",
    severity: "high",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
];

export type SecretScanSeverity = "low" | "medium" | "high";

export interface SecretScanWarning {
  kind: string;
  severity: SecretScanSeverity;
  title: string;
  detail: string;
  paths: string[];
}

export interface SecretScanFileInput {
  path: string;
  status?: string;
  staged?: boolean;
}

export interface SecretScanInputs {
  stagedDiff?: string;
  unstagedDiff?: string;
  branchDiff?: string;
  diff?: string;
  files?: Array<string | SecretScanFileInput>;
  trackedFiles?: string[];
}

interface SecretPattern {
  kind: string;
  severity: SecretScanSeverity;
  title: string;
  regex: RegExp;
}

interface SecretFinding {
  kind: string;
  severity: SecretScanSeverity;
  title: string;
  source: string;
  path: string;
}

export async function scanSecrets(
  repoPath: string,
  inputs: SecretScanInputs = {},
): Promise<SecretScanWarning[]> {
  const findings: SecretFinding[] = [];

  for (const source of diffSources(inputs)) {
    findings.push(...scanDiff(source.label, source.diff));
    if (findings.length >= MAX_WARNINGS) break;
  }

  if (findings.length < MAX_WARNINGS) {
    const candidatePaths = trackedSecretPaths(inputs).slice(
      0,
      MAX_FILES_TO_INSPECT,
    );
    for (const relativePath of candidatePaths) {
      findings.push(...(await inspectTrackedFile(repoPath, relativePath)));
      if (findings.length >= MAX_WARNINGS) break;
    }
  }

  return toWarnings(findings.slice(0, MAX_WARNINGS));
}

function diffSources(inputs: SecretScanInputs): Array<{
  label: string;
  diff: string;
}> {
  return [
    { label: "staged diff", diff: inputs.stagedDiff ?? "" },
    { label: "unstaged diff", diff: inputs.unstagedDiff ?? "" },
    { label: "branch diff", diff: inputs.branchDiff ?? "" },
    { label: "diff", diff: inputs.diff ?? "" },
  ].filter((source) => source.diff.trim().length > 0);
}

function scanDiff(source: string, diff: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  let currentPath = "<unknown>";
  const boundedDiff = diff.slice(0, MAX_DIFF_CHARS);

  for (const rawLine of boundedDiff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ b/")) {
      currentPath = normalizeRelativePath(rawLine.slice(6)) ?? "<unknown>";
      continue;
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;

    const line = rawLine.slice(1);
    findings.push(...scanText(line, currentPath, source));
    if (findings.length >= MAX_WARNINGS) break;
  }

  return findings;
}

async function inspectTrackedFile(
  repoPath: string,
  relativePath: string,
): Promise<SecretFinding[]> {
  const safePath = normalizeRelativePath(relativePath);
  if (!safePath) return [];

  const absolutePath = nodePath.resolve(repoPath, safePath);
  const root = nodePath.resolve(repoPath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${nodePath.sep}`)) {
    return [];
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return [];
  }

  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];

  let text: string;
  try {
    text = await fs.readFile(absolutePath, "utf8");
  } catch {
    return [];
  }

  const source = classifySecretPath(safePath);
  const findings = scanText(text.slice(0, MAX_FILE_BYTES), safePath, source);
  if (findings.length > 0) return findings;

  if (ENV_FILE_RE.test(safePath) || PRIVATE_KEY_FILE_RE.test(safePath)) {
    return [
      {
        kind: "tracked_sensitive_file",
        severity: PRIVATE_KEY_FILE_RE.test(safePath) ? "high" : "medium",
        title: PRIVATE_KEY_FILE_RE.test(safePath)
          ? "Tracked private key file"
          : "Tracked environment file",
        source,
        path: safePath,
      },
    ];
  }

  return [];
}

function trackedSecretPaths(inputs: SecretScanInputs): string[] {
  const paths = new Set<string>();
  for (const path of inputs.trackedFiles ?? []) addSecretPath(paths, path);
  for (const file of inputs.files ?? []) {
    addSecretPath(paths, typeof file === "string" ? file : file.path);
  }
  return Array.from(paths).sort();
}

function addSecretPath(paths: Set<string>, path: string): void {
  const safePath = normalizeRelativePath(path);
  if (!safePath) return;
  if (
    ENV_FILE_RE.test(safePath) ||
    PRIVATE_KEY_FILE_RE.test(safePath) ||
    SECRET_FILE_RE.test(safePath)
  ) {
    paths.add(safePath);
  }
}

function scanText(text: string, path: string, source: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const pattern of PROVIDER_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) {
      findings.push({
        kind: pattern.kind,
        severity: pattern.severity,
        title: pattern.title,
        source,
        path,
      });
    }
  }

  SECRET_ASSIGNMENT_RE.lastIndex = 0;
  let match = SECRET_ASSIGNMENT_RE.exec(text);
  while (match) {
    const value = match[2] ?? "";
    if (looksLikeRealSecret(value)) {
      findings.push({
        kind: "secret_assignment",
        severity: "medium",
        title: "Possible hardcoded secret",
        source,
        path,
      });
    }
    match = SECRET_ASSIGNMENT_RE.exec(text);
  }

  return findings;
}

function looksLikeRealSecret(value: string): boolean {
  const lower = value.toLowerCase();
  if (
    lower.includes("example") ||
    lower.includes("placeholder") ||
    lower.includes("changeme") ||
    lower.includes("your_") ||
    lower.includes("your-") ||
    lower.includes("dummy") ||
    lower.includes("test")
  ) {
    return false;
  }
  if (value.includes("${") || value.includes("process.env")) return false;
  if (/^[x*_~-]+$/.test(value)) return false;
  return /[A-Za-z]/.test(value) && /\d|[+/=_-]/.test(value);
}

function toWarnings(findings: SecretFinding[]): SecretScanWarning[] {
  const warningsByKey = new Map<string, SecretScanWarning>();

  for (const finding of findings) {
    const key = `${finding.kind}:${finding.severity}:${finding.title}:${finding.source}`;
    const existing = warningsByKey.get(key);
    if (existing) {
      if (!existing.paths.includes(finding.path)) {
        existing.paths.push(finding.path);
        existing.paths.sort();
      }
      continue;
    }

    warningsByKey.set(key, {
      kind: finding.kind,
      severity: finding.severity,
      title: finding.title,
      detail: `${finding.source} contains a secret-looking value. Value masked.`,
      paths: [finding.path],
    });
  }

  return Array.from(warningsByKey.values()).sort((a, b) => {
    const severity = severityRank(b.severity) - severityRank(a.severity);
    if (severity !== 0) return severity;
    return a.title.localeCompare(b.title);
  });
}

function severityRank(severity: SecretScanSeverity): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function classifySecretPath(path: string): string {
  if (PRIVATE_KEY_FILE_RE.test(path)) return "tracked private key file";
  if (ENV_FILE_RE.test(path)) return "tracked env file";
  return "tracked secret-like file";
}

function normalizeRelativePath(path: string): string | null {
  const withoutPrefix = path.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  const normalized = nodePath.posix.normalize(withoutPrefix);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    nodePath.isAbsolute(withoutPrefix)
  ) {
    return null;
  }
  return normalized;
}
