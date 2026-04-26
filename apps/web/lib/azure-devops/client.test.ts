import { describe, expect, it, mock } from "bun:test";
import type { AdoApis } from "./client";

mock.module("server-only", () => ({}));

const modulePromise = import("./client");

function makeFakeApis(overrides: Partial<AdoApis> = {}): AdoApis {
  return {
    getCoreApi: mock(async () => ({
      getProjects: mock(async () => []),
    })) as unknown as AdoApis["getCoreApi"],
    getGitApi: mock(async () => ({
      getRepositories: mock(async () => []),
      getRepository: mock(async () => null),
      getPullRequests: mock(async () => []),
      createPullRequest: mock(async () => null),
      getPullRequestById: mock(async () => null),
    })) as unknown as AdoApis["getGitApi"],
    ...overrides,
  };
}

describe("buildAdoClient", () => {
  it("listProjects returns empty array when SDK returns nothing", async () => {
    const { buildAdoClient } = await modulePromise;
    const apis = makeFakeApis();
    const client = buildAdoClient(apis, "contoso");
    expect(await client.listProjects()).toEqual([]);
  });

  it("listRepositories filters by project", async () => {
    const { buildAdoClient } = await modulePromise;
    const apis = makeFakeApis({
      getGitApi: mock(async () => ({
        getRepositories: mock(async (project?: string) => [
          { id: "r1", name: "repo-a", project: { name: project ?? "" } },
        ]),
        getRepository: mock(async () => null),
        getPullRequests: mock(async () => []),
        createPullRequest: mock(async () => null),
        getPullRequestById: mock(async () => null),
      })) as unknown as AdoApis["getGitApi"],
    });
    const client = buildAdoClient(apis, "contoso");
    const repos = await client.listRepositories("MyProject");
    expect(repos[0]?.name).toBe("repo-a");
  });

  it("findPullRequestByBranch returns found:false when no PRs", async () => {
    const { buildAdoClient } = await modulePromise;
    const apis = makeFakeApis();
    const client = buildAdoClient(apis, "contoso");
    const result = await client.findPullRequestByBranch({
      project: "p",
      repo: "r",
      branchName: "feature/x",
    });
    expect(result.found).toBe(false);
  });
});
