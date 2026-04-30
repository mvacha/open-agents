import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const originalFetch = globalThis.fetch;

describe("fetchAdoRepoFile", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the response body on a successful 200", async () => {
    fetchMock = mock(
      async () =>
        new Response('{ "hello": "world" }', {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { fetchAdoRepoFile } = await import("./fetch-repo-file");
    const result = await fetchAdoRepoFile({
      org: "contoso",
      project: "Acme Platform",
      repo: "my-repo",
      branch: "main",
      path: ".open-agents/config.json",
      pat: "pat",
    });

    expect(result).toBe('{ "hello": "world" }');
    const call = fetchMock.mock.calls[0];
    const url = call?.[0] as string;
    expect(url).toContain(
      "https://dev.azure.com/contoso/Acme%20Platform/_apis/git/repositories/my-repo/items?",
    );
    expect(url).toContain("path=.open-agents%2Fconfig.json");
    expect(url).toContain("versionDescriptor.version=main");
    expect(url).toContain("versionDescriptor.versionType=branch");
    expect(url).toContain("api-version=7.1");

    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(":pat").toString("base64")}`,
    );
  });

  it("returns null on a 404", async () => {
    fetchMock = mock(async () => new Response("", { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { fetchAdoRepoFile } = await import("./fetch-repo-file");
    const result = await fetchAdoRepoFile({
      org: "contoso",
      project: "p",
      repo: "r",
      branch: "main",
      path: "x.json",
      pat: "pat",
    });

    expect(result).toBeNull();
  });

  it("throws on non-200/404 responses", async () => {
    fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { fetchAdoRepoFile } = await import("./fetch-repo-file");
    await expect(
      fetchAdoRepoFile({
        org: "contoso",
        project: "p",
        repo: "r",
        branch: "main",
        path: "x.json",
        pat: "pat",
      }),
    ).rejects.toThrow(/500/);
  });
});
