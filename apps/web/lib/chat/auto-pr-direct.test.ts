import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { GitProvider, RepoRef } from "@/lib/git-providers/types";
import type { AutoCreatePrResult } from "./auto-pr-direct";

mock.module("server-only", () => ({}));

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr?: string;
};

let execResults: Map<string, ExecResult>;
let providerTokenResult: string | null = "ghp_user";
let providerDefaultBranch: string | null = "main";
let providerValidIdentifiers = true;
let providerAuthUrl: string | null =
  "https://x-access-token:ghp_user@github.com/acme/repo.git";
let findPullRequestResult: {
  found: boolean;
  prNumber?: number;
  prStatus?: "open" | "closed" | "merged";
  prUrl?: string;
  error?: string;
} = { found: false };
let createPullRequestResult: {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
} = {
  success: true,
  prNumber: 42,
  prUrl: "https://github.com/acme/repo/pull/42",
};
let prContentResult:
  | {
      success: true;
      title: string;
      body: string;
      diffStats: string;
      commitLog: string;
      baseRef: string;
      mergeBase: string | null;
    }
  | { success: false; error: string } = {
  success: true,
  title: "feat: improve auto pr",
  body: "## Summary\n\nAdds auto PR support.",
  diffStats: " file.ts | 1 +",
  commitLog: "abc123 feat: improve auto pr",
  baseRef: "origin/main",
  mergeBase: "abc123",
};

const execSpy = mock(async (command: string): Promise<ExecResult> => {
  for (const [prefix, result] of execResults) {
    if (command.startsWith(prefix) || command.includes(prefix)) {
      return result;
    }
  }

  return { success: true, stdout: "", stderr: "" };
});

const updateSessionSpy = mock(async () => {});
const generatePullRequestContentFromSandboxSpy = mock(
  async () => prContentResult,
);

const validateRepoIdentifiersSpy = mock(() => providerValidIdentifiers);
const getCloneTokenSpy = mock(async (_userId?: string) => providerTokenResult);
const buildAuthRemoteUrlSpy = mock(() => providerAuthUrl);
const getDefaultBranchSpy = mock(async () => providerDefaultBranch);
const findPullRequestByBranchSpy = mock(async () => findPullRequestResult);
const createPullRequestSpy = mock(async () => createPullRequestResult);

function makeFakeProvider(
  id: GitProvider["id"] = "github",
  overrides: Partial<GitProvider> = {},
): GitProvider {
  return {
    id,
    validateRepoIdentifiers: validateRepoIdentifiersSpy,
    getCloneToken: getCloneTokenSpy,
    buildAuthRemoteUrl: buildAuthRemoteUrlSpy,
    getDefaultBranch: getDefaultBranchSpy,
    findPullRequestByBranch: findPullRequestByBranchSpy,
    createPullRequest: createPullRequestSpy,
    getPullRequestStatus: async () => ({ success: true, status: "open" }),
    buildPullRequestUrl: () => "https://example.com/pr/1",
    buildRepoWebUrl: () => "https://example.com/repo",
    ...overrides,
  };
}

const sandbox = {
  workingDirectory: "/vercel/sandbox",
  exec: execSpy,
};

mock.module("@/app/api/generate-pr/_lib/generate-pr-helpers", () => ({
  looksLikeCommitHash: (value: string) => /^[0-9a-f]{7,40}$/i.test(value),
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: updateSessionSpy,
}));

mock.module("@/lib/git/pr-content", () => ({
  generatePullRequestContentFromSandbox:
    generatePullRequestContentFromSandboxSpy,
}));

const { performAutoCreatePr } = await import("./auto-pr-direct");

function defaultExecResults(): Map<string, ExecResult> {
  return new Map<string, ExecResult>([
    [
      "git symbolic-ref --short HEAD",
      { success: true, stdout: "feature-branch" },
    ],
    ["git remote set-url", { success: true, stdout: "" }],
    ["git fetch origin", { success: true, stdout: "" }],
    ["git rev-parse HEAD", { success: true, stdout: "abc123" }],
    [
      "git ls-remote --heads origin",
      {
        success: true,
        stdout: "abc123\trefs/heads/feature-branch",
      },
    ],
    [
      "git symbolic-ref refs/remotes/origin/HEAD",
      { success: true, stdout: "refs/remotes/origin/main" },
    ],
  ]);
}

const githubRef: RepoRef = {
  provider: "github",
  owner: "acme",
  repo: "repo",
};

function makeParams(
  overrides: Partial<Parameters<typeof performAutoCreatePr>[0]> = {},
) {
  return {
    sandbox: sandbox as never,
    userId: "user-1",
    sessionId: "session-1",
    sessionTitle: "Auto PR session",
    provider: makeFakeProvider("github"),
    ref: githubRef,
    ...overrides,
  };
}

beforeEach(() => {
  execSpy.mockClear();
  updateSessionSpy.mockClear();
  generatePullRequestContentFromSandboxSpy.mockClear();
  validateRepoIdentifiersSpy.mockClear();
  getCloneTokenSpy.mockClear();
  buildAuthRemoteUrlSpy.mockClear();
  getDefaultBranchSpy.mockClear();
  findPullRequestByBranchSpy.mockClear();
  createPullRequestSpy.mockClear();

  execResults = defaultExecResults();
  providerTokenResult = "ghp_user";
  providerDefaultBranch = "main";
  providerValidIdentifiers = true;
  providerAuthUrl = "https://x-access-token:ghp_user@github.com/acme/repo.git";
  findPullRequestResult = { found: false };
  createPullRequestResult = {
    success: true,
    prNumber: 42,
    prUrl: "https://github.com/acme/repo/pull/42",
  };
  prContentResult = {
    success: true,
    title: "feat: improve auto pr",
    body: "## Summary\n\nAdds auto PR support.",
    diffStats: " file.ts | 1 +",
    commitLog: "abc123 feat: improve auto pr",
    baseRef: "origin/main",
    mergeBase: "abc123",
  };
});

describe("performAutoCreatePr", () => {
  test("skips when the current branch is detached", async () => {
    execResults.set("git symbolic-ref --short HEAD", {
      success: false,
      stdout: "",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is detached",
    } satisfies AutoCreatePrResult);
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test("skips when the current branch matches the default branch", async () => {
    execResults.set("git symbolic-ref --short HEAD", {
      success: true,
      stdout: "main",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch matches the default branch",
    } satisfies AutoCreatePrResult);
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test("skips when the provider rejects the repo identifiers", async () => {
    providerValidIdentifiers = false;

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason:
        "Repository owner or name is not supported for auto PR creation",
    } satisfies AutoCreatePrResult);
    const setUrlCall = execSpy.mock.calls.find((call) =>
      String(call[0]).includes("git remote set-url"),
    );
    expect(setUrlCall).toBeUndefined();
  });

  test("skips when the current branch is not available on origin", async () => {
    execResults.set("git ls-remote --heads origin", {
      success: true,
      stdout: "",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is not available on origin",
    } satisfies AutoCreatePrResult);
    expect(generatePullRequestContentFromSandboxSpy).not.toHaveBeenCalled();
  });

  test("skips when the current branch is not fully pushed to origin", async () => {
    execResults.set("git ls-remote --heads origin", {
      success: true,
      stdout: "def456\trefs/heads/feature-branch",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is not fully pushed to origin",
    } satisfies AutoCreatePrResult);
    expect(findPullRequestByBranchSpy).not.toHaveBeenCalled();
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test("syncs an existing open pull request instead of creating a new one", async () => {
    findPullRequestResult = {
      found: true,
      prNumber: 7,
      prStatus: "open",
      prUrl: "https://github.com/acme/repo/pull/7",
    };

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: true,
      skipped: false,
      prNumber: 7,
      prUrl: "https://github.com/acme/repo/pull/7",
    } satisfies AutoCreatePrResult);
    expect(updateSessionSpy).toHaveBeenCalledWith("session-1", {
      prNumber: 7,
      prStatus: "open",
    });
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test("creates a new pull request and persists PR metadata", async () => {
    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: true,
      syncedExisting: false,
      skipped: false,
      prNumber: 42,
      prUrl: "https://github.com/acme/repo/pull/42",
    } satisfies AutoCreatePrResult);
    expect(getCloneTokenSpy).toHaveBeenCalledWith("user-1");
    expect(generatePullRequestContentFromSandboxSpy).toHaveBeenCalledTimes(1);
    expect(createPullRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: githubRef,
        branchName: "feature-branch",
        baseBranch: "main",
        title: "feat: improve auto pr",
      }),
    );
    expect(updateSessionSpy).toHaveBeenCalledWith("session-1", {
      prNumber: 42,
      prStatus: "open",
    });
  });

  test("returns an error when PR content generation fails unexpectedly", async () => {
    prContentResult = {
      success: false,
      error: "Failed to resolve the repository default branch",
    };

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: false,
      error: "Failed to resolve the repository default branch",
    } satisfies AutoCreatePrResult);
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test("uses provider.createPullRequest for ADO sessions", async () => {
    const adoRef: RepoRef = {
      provider: "azure_devops",
      org: "o",
      project: "p",
      repo: "r",
    };

    const adoCreatePullRequest = mock(async () => ({
      success: true,
      prNumber: 7,
      prUrl: "https://dev.azure.com/o/p/_git/r/pullrequest/7",
    }));
    const adoFindPullRequestByBranch = mock(async () => ({ found: false }));
    const adoGetCloneToken = mock(async () => "pat");
    const adoGetDefaultBranch = mock(async () => "main");
    const adoBuildAuthRemoteUrl = mock(
      () => "https://anything:pat@dev.azure.com/o/p/_git/r",
    );
    const adoValidateRepoIdentifiers = mock(() => true);

    const adoProvider: GitProvider = {
      id: "azure_devops",
      validateRepoIdentifiers: adoValidateRepoIdentifiers,
      getCloneToken: adoGetCloneToken,
      buildAuthRemoteUrl: adoBuildAuthRemoteUrl,
      getDefaultBranch: adoGetDefaultBranch,
      findPullRequestByBranch: adoFindPullRequestByBranch,
      createPullRequest: adoCreatePullRequest,
      getPullRequestStatus: async () => ({ success: true, status: "open" }),
      buildPullRequestUrl: () =>
        "https://dev.azure.com/o/p/_git/r/pullrequest/7",
      buildRepoWebUrl: () => "https://dev.azure.com/o/p/_git/r",
    };

    const result = await performAutoCreatePr({
      sandbox: sandbox as never,
      userId: "u1",
      sessionId: "s1",
      sessionTitle: "test",
      provider: adoProvider,
      ref: adoRef,
    });

    expect(result.created).toBe(true);
    expect(result.prNumber).toBe(7);
    expect(adoGetCloneToken).toHaveBeenCalledWith("u1");
    expect(adoCreatePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: adoRef,
        branchName: "feature-branch",
        baseBranch: "main",
        token: "pat",
      }),
    );
  });
});
