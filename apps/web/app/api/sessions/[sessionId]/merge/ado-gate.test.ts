import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "u1" }),
  requireOwnedSession: async () => ({
    ok: true,
    sessionRecord: {
      id: "s1",
      userId: "u1",
      cloneUrl: "https://dev.azure.com/contoso/Acme/_git/repo",
      repoOwner: "contoso",
      repoName: "repo",
      repoProvider: "azure_devops" as const,
      repoMeta: { provider: "azure_devops" as const, project: "Acme" },
      branch: "feature/x",
      prNumber: 7,
      prStatus: "open" as const,
    },
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: async () => ({}),
}));

mock.module("@/lib/github/client", () => ({
  getPullRequestMergeReadiness: async () => {
    throw new Error("should not be called for ADO sessions");
  },
  closePullRequest: async () => ({ success: true }),
  deleteBranchRef: async () => ({ success: true }),
  enablePullRequestAutoMerge: async () => ({ success: true }),
  mergePullRequest: async () => ({ success: true, sha: "abc" }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

const { POST } = await import("./route");

function ctx() {
  return { params: Promise.resolve({ sessionId: "s1" }) };
}

describe("POST /api/sessions/[sessionId]/merge — ADO gating", () => {
  test("returns 501 with pointer to ADO when session is azure_devops", async () => {
    const response = await POST(
      new Request("http://localhost/api/sessions/s1/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mergeMethod: "squash", deleteBranch: false }),
      }),
      ctx(),
    );

    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.error).toMatch(/Azure DevOps/i);
  });
});
