import { startBridge } from "./dev-browser-bridge.mjs";

const bridge = await startBridge({ port: 0 });

try {
  if (!process.env.GITHUB_TOKEN?.trim()) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "GITHUB_TOKEN missing for browser bridge GitHub issue smoke.",
      }),
    );
  } else {
    const base = `http://127.0.0.1:${bridge.port}`;
    const repos = await postJson(`${base}/api/github/repos`, {});
    const repoFullName = repos.find((repo) => typeof repo.full_name === "string")?.full_name;
    if (!repoFullName) {
      console.log(JSON.stringify({ skipped: true, reason: "No GitHub repositories returned." }));
    } else {
      const issues = await postJson(`${base}/api/github/issues`, { repoFullName });
      const firstIssueNumber = issues[0]?.number;
      const detail = typeof firstIssueNumber === "number"
        ? await postJson(`${base}/api/github/issues`, {
            repoFullName,
            mode: "detail",
            number: firstIssueNumber,
          })
        : null;

      console.log(
        JSON.stringify(
          {
            repoFullName,
            issueCount: issues.length,
            detailChecked: Boolean(detail),
            firstIssueNumber: firstIssueNumber ?? null,
          },
          null,
          2,
        ),
      );
    }
  }
} finally {
  await bridge.close();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}
