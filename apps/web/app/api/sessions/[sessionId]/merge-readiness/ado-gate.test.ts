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

const adoReadinessCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/git-providers/resolve", () => ({
  getProviderForSession: () => ({
    getCloneToken: async () => "ado-pat",
    getMergeReadiness: async (input: Record<string, unknown>) => {
      adoReadinessCalls.push(input);
      return {
        success: true,
        canMerge: true,
        reasons: [],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 1, passed: 1, pending: 0, failed: 0 },
        checkRuns: [],
        pr: {
          number: 7,
          state: "open",
          isDraft: false,
          title: "ADO PR",
          body: null,
          baseBranch: "main",
          headBranch: "feature/x",
          headSha: "abc1234",
          headOwner: "contoso",
          mergeable: true,
          mergeableState: "Succeeded",
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          commits: 0,
        },
      };
    },
  }),
  sessionToRepoRef: () => ({
    provider: "azure_devops",
    org: "contoso",
    project: "Acme",
    repo: "repo",
  }),
}));

mock.module("@/lib/github/client", () => ({
  getPullRequestMergeReadiness: async () => {
    throw new Error("github client must not be called for ADO sessions");
  },
  closePullRequest: async () => ({ success: false }),
  createPullRequest: async () => ({ success: false }),
  findPullRequestByBranch: async () => ({ found: false }),
  getPullRequestStatus: async () => ({ success: false }),
  mergePullRequest: async () => ({ success: false }),
  deleteBranchRef: async () => ({ success: false }),
  parseGitHubUrl: () => null,
  enablePullRequestAutoMerge: async () => ({ success: false }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

const { GET } = await import("./route");

describe("GET /api/sessions/[sessionId]/merge-readiness — Azure DevOps", () => {
  test("returns provider readiness data without calling the GitHub client", async () => {
    const response = await GET(new Request("http://localhost/api/x"), {
      params: Promise.resolve({ sessionId: "s1" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      canMerge: boolean;
      pr: { title: string | null } | null;
    };
    expect(body.canMerge).toBe(true);
    expect(body.pr?.title).toBe("ADO PR");
    expect(adoReadinessCalls).toHaveLength(1);
  });
});
