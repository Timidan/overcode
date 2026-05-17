export type GraniteFeature =
  | "impact"
  | "commit"
  | "brief"
  | "pr_review"
  | "pr_hunk_review"
  | "pr_file_change"
  | "issue_triage"
  | "code_explain"
  | "stash_explain"
  | "worktree_compare"
  | "standup";

export type AIConfidence = "low" | "medium" | "high";
export type Severity = "low" | "medium" | "high";

export interface GraniteEnvelope<T> {
  schemaVersion: 1;
  feature: GraniteFeature;
  summary: string;
  confidence: AIConfidence;
  data: T;
  warnings: string[];
  raw?: string;
}

export interface ImpactData {
  intent: string;
  modules: Array<{
    name: string;
    paths: string[];
    changeType: "added" | "modified" | "removed" | "mixed";
  }>;
  risks: Array<{
    severity: Severity;
    area: string;
    reason: string;
    files: string[];
  }>;
  checks: Array<{ command?: string; reason: string }>;
  recommendation: string;
}

export interface CommitData {
  commit: {
    type: string;
    scope: string;
    description: string;
    body: string;
  };
  pr: {
    title: string;
    description: string;
    checklist: string[];
  };
  changedModules: string[];
  riskLevel: Severity;
}

export interface RepoBriefData {
  purpose: string;
  keyModules: Array<{ name: string; path: string; role: string }>;
  recentActivity: Array<{ label: string; evidence: string }>;
  onboardingPath: string[];
  notableRisks: string[];
}

export interface PRReviewData {
  readiness: "blocked" | "needs_review" | "ready";
  changeSummary: string;
  riskMatrix: Array<{
    severity: Severity;
    file?: string;
    concern: string;
    evidence: string;
  }>;
  blockers: Array<{
    source: "conversation" | "ci" | "diff";
    text: string;
    url?: string;
  }>;
  ci: {
    passing: number;
    failing: number;
    pending: number;
    notable: string[];
  };
  suggestedComment: string;
}

export interface PRHunkReviewData {
  overall: "low_risk" | "needs_attention" | "blocked";
  hunks: Array<{
    file: string;
    header: string;
    verdict: "safe" | "question" | "risk" | "needs_test";
    note: string;
    suggestedCheck?: string;
  }>;
  questions: string[];
  tests: string[];
}

export interface PRFileChangeData {
  added: string[];
  removed: string[];
  changedBehavior: string;
  risk: Severity;
  reviewFocus: string[];
  suggestedChecks: string[];
}

export interface IssueTriageData {
  priority: Severity;
  problem: string;
  likelyModules: Array<{ name: string; paths: string[]; reason: string }>;
  ambiguities: string[];
  suggestedPlan: string[];
  acceptanceChecks: string[];
  suggestedBranchName: string;
}

export interface CodeExplanationData {
  subject: string;
  purpose: string;
  keyPoints: string[];
  risks: Array<{ severity: Severity; text: string }>;
  suggestedChecks: string[];
}

export interface StashExplainData {
  intent: string;
  files: string[];
  added: string[];
  removed: string[];
  risks: Array<{ severity: Severity; text: string; files: string[] }>;
  suggestedActions: string[];
  label: string;
}

export interface WorktreeCompareData {
  base: string;
  target: string;
  ahead: number;
  behind: number;
  dirtyFiles: number;
  intent: string;
  moduleMap: Array<{ module: string; files: string[]; risk: Severity }>;
  readiness: "not_ready" | "reviewable" | "ready";
  nextActions: string[];
  prDraft?: { title: string; body: string };
}

export interface StandupData {
  greeting: string;
  headline: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  notableRepos: Array<{ repo: string; note: string }>;
  slackDraft: string;
}

export type DataValidator<T> = (value: unknown) => T | null;

export function parseGraniteEnvelope<T>(
  raw: string,
  feature: GraniteFeature,
  validateData: DataValidator<T>,
): GraniteEnvelope<T> | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const object = asRecord(parsed);
  if (!object) return null;
  // Granite sometimes returns the requested `data` object directly instead
  // of wrapping it in the full Overcode envelope. Accept that shape and wrap
  // it here so callers still get the structured UI they asked for.
  const dataSource = "data" in object ? object.data : object;
  const data = validateData(dataSource);
  if (!data) return null;

  return {
    schemaVersion: 1,
    feature,
    summary: asString(object.summary) || summarizeDataFallback(data),
    confidence: asConfidence(object.confidence),
    data,
    warnings: asStringArray(object.warnings),
    raw,
  };
}

export function fallbackEnvelope<T>(
  feature: GraniteFeature,
  summary: string,
  data: T,
  warnings: string[] = [],
  raw?: string,
): GraniteEnvelope<T> {
  return {
    schemaVersion: 1,
    feature,
    summary,
    confidence: "low",
    data,
    warnings,
    raw,
  };
}

export function extractJsonObject(raw: string): string | null {
  const withoutFences = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const first = withoutFences.indexOf("{");
  if (first === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = first; index < withoutFences.length; index += 1) {
    const char = withoutFences[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return withoutFences.slice(first, index + 1);
    }
  }
  return null;
}

export function parseJsonObject(raw: string): unknown | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function validateImpactData(value: unknown): ImpactData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    intent: asString(object.intent),
    modules: asArray(object.modules)
      .map((item) => {
        const module = asRecord(item);
        if (!module) return null;
        return {
          name: asString(module.name) || "Changed module",
          paths: asStringArray(module.paths),
          changeType: asChangeType(module.changeType),
        };
      })
      .filter(isPresent),
    risks: asArray(object.risks)
      .map((item) => {
        const risk = asRecord(item);
        if (!risk) return null;
        return {
          severity: asSeverity(risk.severity),
          area: asString(risk.area) || "Risk area",
          reason: asString(risk.reason),
          files: asStringArray(risk.files),
        };
      })
      .filter(isPresent),
    checks: asArray(object.checks)
      .map((item) => {
        const check = asRecord(item);
        if (!check) return null;
        return {
          command: optionalString(check.command),
          reason: asString(check.reason),
        };
      })
      .filter(isPresent),
    recommendation: asString(object.recommendation),
  };
}

export function validateRepoBriefData(value: unknown): RepoBriefData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    purpose: asString(object.purpose),
    keyModules: asArray(object.keyModules)
      .map((item) => {
        const module = asRecord(item);
        if (!module) return null;
        return {
          name: asString(module.name) || asString(module.path) || "Module",
          path: asString(module.path),
          role: asString(module.role),
        };
      })
      .filter(isPresent),
    recentActivity: asArray(object.recentActivity)
      .map((item) => {
        const activity = asRecord(item);
        if (!activity) return null;
        return {
          label: asString(activity.label),
          evidence: asString(activity.evidence),
        };
      })
      .filter(isPresent),
    onboardingPath: asStringArray(object.onboardingPath),
    notableRisks: asStringArray(object.notableRisks),
  };
}

export function validatePRReviewData(value: unknown): PRReviewData | null {
  const object = asRecord(value);
  if (!object) return null;
  const ci = asRecord(object.ci);
  return {
    readiness: asPRReadiness(object.readiness),
    changeSummary: asString(object.changeSummary),
    riskMatrix: asArray(object.riskMatrix)
      .map((item) => {
        const risk = asRecord(item);
        if (!risk) return null;
        return {
          severity: asSeverity(risk.severity),
          file: optionalString(risk.file),
          concern: asString(risk.concern),
          evidence: asString(risk.evidence),
        };
      })
      .filter(isPresent),
    blockers: asArray(object.blockers)
      .map((item) => {
        const blocker = asRecord(item);
        if (!blocker) return null;
        return {
          source: asBlockerSource(blocker.source),
          text: asString(blocker.text),
          url: optionalString(blocker.url),
        };
      })
      .filter(isPresent),
    ci: {
      passing: asNumber(ci?.passing),
      failing: asNumber(ci?.failing),
      pending: asNumber(ci?.pending),
      notable: asStringArray(ci?.notable),
    },
    suggestedComment: asString(object.suggestedComment),
  };
}

export function validatePRHunkReviewData(value: unknown): PRHunkReviewData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    overall: asHunkOverall(object.overall),
    hunks: asArray(object.hunks)
      .map((item) => {
        const hunk = asRecord(item);
        if (!hunk) return null;
        return {
          file: asString(hunk.file),
          header: asString(hunk.header),
          verdict: asHunkVerdict(hunk.verdict),
          note: asString(hunk.note),
          suggestedCheck: optionalString(hunk.suggestedCheck),
        };
      })
      .filter(isPresent),
    questions: asStringArray(object.questions),
    tests: asStringArray(object.tests),
  };
}

export function validatePRFileChangeData(value: unknown): PRFileChangeData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    added: asStringArray(object.added),
    removed: asStringArray(object.removed),
    changedBehavior: asString(object.changedBehavior),
    risk: asSeverity(object.risk),
    reviewFocus: asStringArray(object.reviewFocus),
    suggestedChecks: asStringArray(object.suggestedChecks),
  };
}

export function validateIssueTriageData(value: unknown): IssueTriageData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    priority: asSeverity(object.priority),
    problem: asString(object.problem),
    likelyModules: asArray(object.likelyModules)
      .map((item) => {
        const module = asRecord(item);
        if (!module) return null;
        return {
          name: asString(module.name) || "Possible module",
          paths: asStringArray(module.paths),
          reason: asString(module.reason),
        };
      })
      .filter(isPresent),
    ambiguities: asStringArray(object.ambiguities),
    suggestedPlan: asStringArray(object.suggestedPlan),
    acceptanceChecks: asStringArray(object.acceptanceChecks),
    suggestedBranchName: asString(object.suggestedBranchName),
  };
}

export function validateCodeExplanationData(value: unknown): CodeExplanationData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    subject: asString(object.subject),
    purpose: asString(object.purpose),
    keyPoints: asStringArray(object.keyPoints),
    risks: asArray(object.risks)
      .map((item) => {
        const risk = asRecord(item);
        if (!risk) return null;
        return {
          severity: asSeverity(risk.severity),
          text: asString(risk.text),
        };
      })
      .filter(isPresent),
    suggestedChecks: asStringArray(object.suggestedChecks),
  };
}

export function validateStashExplainData(value: unknown): StashExplainData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    intent: asString(object.intent),
    files: asStringArray(object.files),
    added: asStringArray(object.added),
    removed: asStringArray(object.removed),
    risks: asArray(object.risks)
      .map((item) => {
        const risk = asRecord(item);
        if (!risk) return null;
        return {
          severity: asSeverity(risk.severity),
          text: asString(risk.text),
          files: asStringArray(risk.files),
        };
      })
      .filter(isPresent),
    suggestedActions: asStringArray(object.suggestedActions),
    label: asString(object.label),
  };
}

export function validateWorktreeCompareData(value: unknown): WorktreeCompareData | null {
  const object = asRecord(value);
  if (!object) return null;
  const prDraft = asRecord(object.prDraft);
  return {
    base: asString(object.base),
    target: asString(object.target),
    ahead: asNumber(object.ahead),
    behind: asNumber(object.behind),
    dirtyFiles: asNumber(object.dirtyFiles),
    intent: asString(object.intent),
    moduleMap: asArray(object.moduleMap)
      .map((item) => {
        const module = asRecord(item);
        if (!module) return null;
        return {
          module: asString(module.module) || "Changed module",
          files: asStringArray(module.files),
          risk: asSeverity(module.risk),
        };
      })
      .filter(isPresent),
    readiness: asWorktreeReadiness(object.readiness),
    nextActions: asStringArray(object.nextActions),
    prDraft: prDraft
      ? {
          title: asString(prDraft.title),
          body: asString(prDraft.body),
        }
      : undefined,
  };
}

export function validateStandupData(value: unknown): StandupData | null {
  const object = asRecord(value);
  if (!object) return null;
  return {
    greeting: asString(object.greeting),
    headline: asString(object.headline),
    yesterday: asStringArray(object.yesterday),
    today: asStringArray(object.today),
    blockers: asStringArray(object.blockers),
    notableRepos: asArray(object.notableRepos)
      .map((item) => {
        const repo = asRecord(item);
        if (!repo) return null;
        return {
          repo: asString(repo.repo),
          note: asString(repo.note),
        };
      })
      .filter(isPresent),
    slackDraft: asString(object.slackDraft),
  };
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const stringValue = asString(value);
  return stringValue || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asConfidence(value: unknown): AIConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function asSeverity(value: unknown): Severity {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function asChangeType(value: unknown): ImpactData["modules"][number]["changeType"] {
  if (
    value === "added" ||
    value === "modified" ||
    value === "removed" ||
    value === "mixed"
  ) {
    return value;
  }
  return "mixed";
}

function asPRReadiness(value: unknown): PRReviewData["readiness"] {
  if (value === "blocked" || value === "needs_review" || value === "ready") {
    return value;
  }
  return "needs_review";
}

function asWorktreeReadiness(value: unknown): WorktreeCompareData["readiness"] {
  if (value === "not_ready" || value === "reviewable" || value === "ready") {
    return value;
  }
  return "reviewable";
}

function asHunkOverall(value: unknown): PRHunkReviewData["overall"] {
  if (value === "low_risk" || value === "needs_attention" || value === "blocked") {
    return value;
  }
  return "needs_attention";
}

function asHunkVerdict(value: unknown): PRHunkReviewData["hunks"][number]["verdict"] {
  if (
    value === "safe" ||
    value === "question" ||
    value === "risk" ||
    value === "needs_test"
  ) {
    return value;
  }
  return "question";
}

function asBlockerSource(value: unknown): PRReviewData["blockers"][number]["source"] {
  if (value === "conversation" || value === "ci" || value === "diff") return value;
  return "diff";
}

function summarizeDataFallback(value: unknown): string {
  if (value && typeof value === "object") return "Watson returned structured analysis.";
  return "Watson returned analysis.";
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
