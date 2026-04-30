import { describe, expect, it, mock } from "bun:test";
import type { GitProvider, RepoRef } from "@/lib/git-providers/types";

mock.module("server-only", () => ({}));

const fetchModulePromise = import("./fetch");

const githubRef: RepoRef = {
  provider: "github",
  owner: "octocat",
  repo: "hello-world",
};

function makeProvider(
  fetchRepoFile: GitProvider["fetchRepoFile"],
): GitProvider {
  return {
    id: "github",
    validateRepoIdentifiers: () => true,
    getCloneToken: async () => null,
    buildAuthRemoteUrl: () => null,
    getDefaultBranch: async () => null,
    findPullRequestByBranch: async () => ({ found: false }),
    createPullRequest: async () => ({ success: false }),
    getPullRequestStatus: async () => ({ success: false }),
    buildPullRequestUrl: () => "",
    buildRepoWebUrl: () => "",
    fetchRepoFile,
  };
}

describe("fetchOpenAgentsConfigFromProvider", () => {
  it("returns the parsed config on success", async () => {
    const { fetchOpenAgentsConfigFromProvider } = await fetchModulePromise;
    const provider = makeProvider(async () =>
      JSON.stringify({
        dev: [{ name: "web", run: "bun dev", port: 5173 }],
      }),
    );

    const result = await fetchOpenAgentsConfigFromProvider({
      provider,
      ref: githubRef,
      branch: "main",
      token: "tok",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.config.dev[0]?.port).toBe(5173);
    }
  });

  it("returns missing when fetchRepoFile resolves to null", async () => {
    const { fetchOpenAgentsConfigFromProvider } = await fetchModulePromise;
    const provider = makeProvider(async () => null);

    const result = await fetchOpenAgentsConfigFromProvider({
      provider,
      ref: githubRef,
      branch: "main",
      token: "tok",
    });

    expect(result.kind).toBe("missing");
  });

  it("returns invalid when JSON is malformed", async () => {
    const { fetchOpenAgentsConfigFromProvider } = await fetchModulePromise;
    const provider = makeProvider(async () => "not json");

    const result = await fetchOpenAgentsConfigFromProvider({
      provider,
      ref: githubRef,
      branch: "main",
      token: "tok",
    });

    expect(result.kind).toBe("invalid");
  });

  it("returns invalid when schema fails", async () => {
    const { fetchOpenAgentsConfigFromProvider } = await fetchModulePromise;
    const provider = makeProvider(async () => JSON.stringify({}));

    const result = await fetchOpenAgentsConfigFromProvider({
      provider,
      ref: githubRef,
      branch: "main",
      token: "tok",
    });

    expect(result.kind).toBe("invalid");
  });

  it("returns error when fetchRepoFile throws", async () => {
    const { fetchOpenAgentsConfigFromProvider } = await fetchModulePromise;
    const provider = makeProvider(async () => {
      throw new Error("network down");
    });

    const result = await fetchOpenAgentsConfigFromProvider({
      provider,
      ref: githubRef,
      branch: "main",
      token: "tok",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error).toContain("network down");
    }
  });
});

describe("uniquePortsFromConfig", () => {
  it("returns ports preserving declaration order", async () => {
    const { uniquePortsFromConfig } = await fetchModulePromise;
    expect(
      uniquePortsFromConfig({
        dev: [
          { name: "web", run: "x", port: 5173, cwd: "." },
          { name: "api", run: "y", port: 3001, cwd: "." },
        ],
      }),
    ).toEqual([5173, 3001]);
  });
});
