import { describe, expect, it } from "bun:test";
import {
  buildBranchUrl,
  buildCommitUrl,
  buildCompareUrl,
  buildPullRequestUrl,
  buildRepoWebUrl,
} from "./url-builders";

describe("buildRepoWebUrl", () => {
  it("returns null when repoOwner missing", () => {
    expect(buildRepoWebUrl({ repoOwner: null, repoName: "r" })).toBeNull();
  });

  it("returns null when repoName missing", () => {
    expect(buildRepoWebUrl({ repoOwner: "o", repoName: null })).toBeNull();
  });

  it("builds GitHub URL when repoProvider absent (legacy default)", () => {
    expect(buildRepoWebUrl({ repoOwner: "octocat", repoName: "hello" })).toBe(
      "https://github.com/octocat/hello",
    );
  });

  it("builds GitHub URL when repoProvider=github", () => {
    expect(
      buildRepoWebUrl({
        repoOwner: "octocat",
        repoName: "hello",
        repoProvider: "github",
      }),
    ).toBe("https://github.com/octocat/hello");
  });

  it("builds ADO URL with project from repoMeta and encodes spaces", () => {
    expect(
      buildRepoWebUrl({
        repoOwner: "contoso",
        repoName: "my-repo",
        repoProvider: "azure_devops",
        repoMeta: { provider: "azure_devops", project: "Acme Platform" },
      }),
    ).toBe("https://dev.azure.com/contoso/Acme%20Platform/_git/my-repo");
  });

  it("returns null for ADO when repoMeta lacks project", () => {
    expect(
      buildRepoWebUrl({
        repoOwner: "contoso",
        repoName: "my-repo",
        repoProvider: "azure_devops",
        repoMeta: null,
      }),
    ).toBeNull();
  });

  it("returns null for ADO when repoMeta has wrong provider", () => {
    expect(
      buildRepoWebUrl({
        repoOwner: "contoso",
        repoName: "my-repo",
        repoProvider: "azure_devops",
        repoMeta: { provider: "github" },
      }),
    ).toBeNull();
  });
});

describe("buildPullRequestUrl", () => {
  it("uses /pull/ for GitHub", () => {
    expect(
      buildPullRequestUrl(
        { repoOwner: "octocat", repoName: "hello", repoProvider: "github" },
        42,
      ),
    ).toBe("https://github.com/octocat/hello/pull/42");
  });

  it("uses /pullrequest/ for ADO", () => {
    expect(
      buildPullRequestUrl(
        {
          repoOwner: "contoso",
          repoName: "my-repo",
          repoProvider: "azure_devops",
          repoMeta: { provider: "azure_devops", project: "Acme" },
        },
        42,
      ),
    ).toBe("https://dev.azure.com/contoso/Acme/_git/my-repo/pullrequest/42");
  });
});

describe("buildBranchUrl", () => {
  it("uses /tree/ for GitHub", () => {
    expect(
      buildBranchUrl(
        { repoOwner: "octocat", repoName: "hello", repoProvider: "github" },
        "feat/x",
      ),
    ).toBe("https://github.com/octocat/hello/tree/feat/x");
  });

  it("uses ?version=GB encoded for ADO", () => {
    expect(
      buildBranchUrl(
        {
          repoOwner: "contoso",
          repoName: "r",
          repoProvider: "azure_devops",
          repoMeta: { provider: "azure_devops", project: "P" },
        },
        "feat/x",
      ),
    ).toBe("https://dev.azure.com/contoso/P/_git/r?version=GBfeat%2Fx");
  });
});

describe("buildCommitUrl", () => {
  it("encodes commit sha for GitHub", () => {
    expect(
      buildCommitUrl(
        { repoOwner: "octocat", repoName: "hello", repoProvider: "github" },
        "abc123",
      ),
    ).toBe("https://github.com/octocat/hello/commit/abc123");
  });

  it("encodes commit sha for ADO", () => {
    expect(
      buildCommitUrl(
        {
          repoOwner: "contoso",
          repoName: "r",
          repoProvider: "azure_devops",
          repoMeta: { provider: "azure_devops", project: "P" },
        },
        "abc123",
      ),
    ).toBe("https://dev.azure.com/contoso/P/_git/r/commit/abc123");
  });
});

describe("buildCompareUrl", () => {
  it("uses /compare/ for GitHub", () => {
    expect(
      buildCompareUrl(
        { repoOwner: "o", repoName: "r", repoProvider: "github" },
        "main",
        "feat",
      ),
    ).toBe("https://github.com/o/r/compare/main...feat");
  });

  it("uses ADO branches comparison URL with GB prefix", () => {
    expect(
      buildCompareUrl(
        {
          repoOwner: "o",
          repoName: "r",
          repoProvider: "azure_devops",
          repoMeta: { provider: "azure_devops", project: "P" },
        },
        "main",
        "feat",
      ),
    ).toBe(
      "https://dev.azure.com/o/P/_git/r/branches?baseVersion=GBmain&targetVersion=GBfeat&_a=files",
    );
  });
});
