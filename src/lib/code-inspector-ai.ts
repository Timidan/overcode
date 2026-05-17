import { ipc, type RepoFileReadOptions } from "./ipc";
import {
  explainCodeSelectionStructured,
  type CodeExplainPayload,
} from "./ai-features";

export async function explainRepoFile(
  repoPath: string,
  filePath: string,
  options: RepoFileReadOptions & { force?: boolean } = {},
) {
  const file = await ipc.readRepoFile(repoPath, filePath, options);
  const payload: CodeExplainPayload = file.binary
    ? {
        kind: "file",
        subject: file.path,
        language: file.language,
        content: "",
        unavailableReason: "Code explanation unavailable for binary files.",
      }
    : {
        kind: "file",
        subject: file.path,
        language: file.language,
        content: file.content,
        context: [
          `source=${file.source}`,
          file.ref ? `ref=${file.ref}` : "",
          file.truncated ? "content was truncated" : "",
        ].filter(Boolean).join("; "),
      };

  return explainCodeSelectionStructured(payload, { force: options.force });
}

export async function explainDiffHunk(
  subject: string,
  diffHunk: string,
  options: { language?: string; context?: string; force?: boolean } = {},
) {
  return explainCodeSelectionStructured(
    {
      kind: "diff-hunk",
      subject,
      language: options.language,
      content: diffHunk,
      context: options.context,
    },
    { force: options.force },
  );
}
