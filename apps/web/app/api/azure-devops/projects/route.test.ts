import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "u1" } }),
}));

let adoEnabled = true;
let adoOrg: string | null = "contoso";
let adoPat: string | null = "pat";
let listProjectsResult: Array<{
  id: string;
  name: string;
  description: string | null;
}> = [];
let listProjectsThrows = false;

mock.module("@/lib/git-providers/feature-flags", () => ({
  isAzureDevOpsEnabled: () => adoEnabled,
  isGitHubEnabled: () => true,
}));

mock.module("@/lib/azure-devops/config", () => ({
  getAzureDevOpsConfig: () =>
    adoEnabled && adoOrg && adoPat
      ? { enabled: true, org: adoOrg, pat: adoPat }
      : { enabled: false },
}));

mock.module("@/lib/azure-devops/client", () => ({
  getAdoClient: () =>
    adoEnabled
      ? {
          listProjects: async () => {
            if (listProjectsThrows) throw new Error("boom");
            return listProjectsResult;
          },
          listRepositories: async () => [],
          getRepository: async () => null,
          findPullRequestByBranch: async () => ({ found: false }),
          createPullRequest: async () => ({ success: false }),
          getPullRequestStatus: async () => ({ success: false }),
        }
      : null,
}));

afterEach(() => {
  adoEnabled = true;
  adoOrg = "contoso";
  adoPat = "pat";
  listProjectsResult = [];
  listProjectsThrows = false;
});

const { GET } = await import("./route");

describe("GET /api/azure-devops/projects", () => {
  it("returns 403 provider_disabled when ADO is disabled", async () => {
    adoEnabled = false;

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "provider_disabled",
      provider: "azure_devops",
    });
  });

  it("returns projects and org slug when enabled", async () => {
    listProjectsResult = [
      { id: "p1", name: "Acme", description: null },
      { id: "p2", name: "Beta", description: "side project" },
    ];

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      org: "contoso",
      projects: listProjectsResult,
    });
  });

  it("returns 502 when SDK call throws", async () => {
    listProjectsThrows = true;

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "ado_request_failed" });
  });
});
