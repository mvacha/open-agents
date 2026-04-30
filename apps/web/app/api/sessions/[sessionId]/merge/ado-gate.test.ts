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

const adoMergeCalls: Array<Record<string, unknown>> = [];
const adoDeleteCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/git-providers/resolve", () => ({
  getProviderForSession: () => ({
    getCloneToken: async () => "ado-pat",
    getMergeReadiness: async () => ({
      success: true,
      canMerge: true,
      reasons: [],
      allowedMethods: ["squash", "merge", "rebase"],
      defaultMethod: "squash",
      checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
      pr: {
        number: 7,
        state: "open",
        isDraft: false,
        title: "x",
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
    }),
    mergePullRequest: async (input: Record<string, unknown>) => {
      adoMergeCalls.push(input);
      return { success: true, sha: "abc" };
    },
    deleteBranch: async (input: Record<string, unknown>) => {
      adoDeleteCalls.push(input);
      return { success: true };
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
  // The github-provider transitively imports these; we never want them invoked.
  getPullRequestMergeReadiness: async () => {
    throw new Error("github client must not be called for ADO sessions");
  },
  closePullRequest: async () => {
    throw new Error("github client must not be called for ADO sessions");
  },
  deleteBranchRef: async () => {
    throw new Error("github client must not be called for ADO sessions");
  },
  enablePullRequestAutoMerge: async () => ({ success: false }),
  mergePullRequest: async () => {
    throw new Error("github client must not be called for ADO sessions");
  },
  parseGitHubUrl: () => null,
  createPullRequest: async () => ({ success: false }),
  findPullRequestByBranch: async () => ({ found: false }),
  getPullRequestStatus: async () => ({ success: false }),
}));

const { POST } = await import("./route");

function ctx() {
  return { params: Promise.resolve({ sessionId: "s1" }) };
}

describe("POST /api/sessions/[sessionId]/merge — Azure DevOps", () => {
  test("merges via the provider abstraction without calling the GitHub client", async () => {
    const response = await POST(
      new Request("http://localhost/api/sessions/s1/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mergeMethod: "squash", deleteBranch: false }),
      }),
      ctx(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      merged: boolean;
      mergeCommitSha: string | null;
    };
    expect(body.merged).toBe(true);
    expect(body.mergeCommitSha).toBe("abc");
    expect(adoMergeCalls).toHaveLength(1);
  });
});
