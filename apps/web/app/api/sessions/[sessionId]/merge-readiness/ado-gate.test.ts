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

mock.module("@/lib/github/client", () => ({
  getPullRequestMergeReadiness: async () => {
    throw new Error("should not be called for ADO sessions");
  },
  // The github-provider module also imports these from this path; supply
  // safe no-ops so transitive imports still resolve.
  createPullRequest: async () => ({ success: false }),
  findPullRequestByBranch: async () => ({ found: false }),
  getPullRequestStatus: async () => ({ success: false }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

const { GET } = await import("./route");

describe("GET /api/sessions/[sessionId]/merge-readiness — ADO gating", () => {
  test("returns 200 with unavailable readiness for ADO sessions and does not call GitHub", async () => {
    const response = await GET(new Request("http://localhost/api/x"), {
      params: Promise.resolve({ sessionId: "s1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canMerge).toBe(false);
    expect(body.reasons[0]).toMatch(/Azure DevOps/i);
  });
});
