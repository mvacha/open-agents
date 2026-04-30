import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const modulePromise = import("./resolve");

const baseSession = {
  id: "s1",
  repoOwner: "octocat",
  repoName: "hello-world",
  branch: "main",
  cloneUrl: "https://github.com/octocat/hello-world",
};

describe("sessionToRepoRef", () => {
  it("builds github ref when repoProvider=github", async () => {
    const { sessionToRepoRef } = await modulePromise;
    expect(
      sessionToRepoRef({
        ...baseSession,
        repoProvider: "github",
        repoMeta: null,
      }),
    ).toEqual({
      provider: "github",
      owner: "octocat",
      repo: "hello-world",
    });
  });

  it("builds ado ref when repoProvider=azure_devops with project meta", async () => {
    const { sessionToRepoRef } = await modulePromise;
    expect(
      sessionToRepoRef({
        ...baseSession,
        repoOwner: "contoso",
        repoName: "my-repo",
        repoProvider: "azure_devops",
        repoMeta: { provider: "azure_devops", project: "AcmePlatform" },
      }),
    ).toEqual({
      provider: "azure_devops",
      org: "contoso",
      project: "AcmePlatform",
      repo: "my-repo",
    });
  });

  it("returns null when ADO session has no project in repoMeta", async () => {
    const { sessionToRepoRef } = await modulePromise;
    expect(
      sessionToRepoRef({
        ...baseSession,
        repoProvider: "azure_devops",
        repoMeta: null,
      }),
    ).toBeNull();
  });

  it("returns null when repoOwner missing", async () => {
    const { sessionToRepoRef } = await modulePromise;
    expect(
      sessionToRepoRef({
        ...baseSession,
        repoOwner: null,
        repoProvider: "github",
        repoMeta: null,
      }),
    ).toBeNull();
  });
});

describe("getProviderById", () => {
  it("returns github provider", async () => {
    const { getProviderById } = await modulePromise;
    expect(getProviderById("github").id).toBe("github");
  });
  it("returns ado provider", async () => {
    const { getProviderById } = await modulePromise;
    expect(getProviderById("azure_devops").id).toBe("azure_devops");
  });
});

describe("getProviderForSession", () => {
  it("dispatches by repo_provider", async () => {
    const { getProviderForSession } = await modulePromise;
    const provider = getProviderForSession({
      ...baseSession,
      repoProvider: "github",
      repoMeta: null,
    });
    expect(provider.id).toBe("github");
  });
});
