import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const apiModulePromise = import("./api");

const originalFetch = globalThis.fetch;

describe("fetchGitHubRepoFile", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("decodes base64 content from a successful response", async () => {
    const { fetchGitHubRepoFile } = await apiModulePromise;
    const body = JSON.stringify({
      content: Buffer.from("hello world", "utf-8").toString("base64"),
      encoding: "base64",
    });
    fetchMock = mock(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await fetchGitHubRepoFile({
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      path: ".open-agents/config.json",
      token: "ghp_abc",
    });

    expect(result).toBe("hello world");
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      "https://api.github.com/repos/octocat/hello-world/contents/.open-agents/config.json?ref=main",
    );
    expect(
      (call?.[1] as RequestInit | undefined)?.headers as Record<string, string>,
    ).toMatchObject({
      Authorization: "Bearer ghp_abc",
    });
  });

  it("returns null when the file does not exist", async () => {
    const { fetchGitHubRepoFile } = await apiModulePromise;
    fetchMock = mock(async () => new Response("", { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await fetchGitHubRepoFile({
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      path: ".open-agents/config.json",
      token: "ghp_abc",
    });

    expect(result).toBeNull();
  });

  it("throws on non-200/404 responses", async () => {
    const { fetchGitHubRepoFile } = await apiModulePromise;
    fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      fetchGitHubRepoFile({
        owner: "octocat",
        repo: "hello-world",
        branch: "main",
        path: ".open-agents/config.json",
        token: "ghp_abc",
      }),
    ).rejects.toThrow(/500/);
  });

  it("throws when response shape is unexpected", async () => {
    const { fetchGitHubRepoFile } = await apiModulePromise;
    const body = JSON.stringify({ encoding: "utf-8", content: "hello" });
    fetchMock = mock(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      fetchGitHubRepoFile({
        owner: "octocat",
        repo: "hello-world",
        branch: "main",
        path: "config.json",
        token: "ghp_abc",
      }),
    ).rejects.toThrow(/unexpected response shape/);
  });
});
