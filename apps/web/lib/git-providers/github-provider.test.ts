import { describe, expect, it, mock } from "bun:test";
import type { RepoRef } from "./types";

mock.module("server-only", () => ({}));

const modulePromise = import("./github-provider");

const githubRef: RepoRef = {
  provider: "github",
  owner: "octocat",
  repo: "hello-world",
};

describe("gitHubProvider", () => {
  it("has id 'github'", async () => {
    const { gitHubProvider } = await modulePromise;
    expect(gitHubProvider.id).toBe("github");
  });

  it("validates a valid github ref", async () => {
    const { gitHubProvider } = await modulePromise;
    expect(gitHubProvider.validateRepoIdentifiers(githubRef)).toBe(true);
  });

  it("rejects an azure_devops ref", async () => {
    const { gitHubProvider } = await modulePromise;
    expect(
      gitHubProvider.validateRepoIdentifiers({
        provider: "azure_devops",
        org: "x",
        project: "y",
        repo: "z",
      }),
    ).toBe(false);
  });

  it("buildAuthRemoteUrl produces a github URL", async () => {
    const { gitHubProvider } = await modulePromise;
    const url = gitHubProvider.buildAuthRemoteUrl({
      token: "ghp_abc",
      ref: githubRef,
    });
    expect(url).toContain("github.com/octocat/hello-world.git");
  });

  it("buildPullRequestUrl produces github format", async () => {
    const { gitHubProvider } = await modulePromise;
    expect(gitHubProvider.buildPullRequestUrl(githubRef, 42)).toBe(
      "https://github.com/octocat/hello-world/pull/42",
    );
  });

  it("buildRepoWebUrl produces github format", async () => {
    const { gitHubProvider } = await modulePromise;
    expect(gitHubProvider.buildRepoWebUrl(githubRef)).toBe(
      "https://github.com/octocat/hello-world",
    );
  });
});
