import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "u1" } }),
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => [],
}));

mock.module("@/lib/github/installation-url", () => ({
  getInstallationManageUrl: () => null,
}));

const ORIGINAL_GH = process.env.GITHUB_ENABLED;

afterEach(() => {
  process.env.GITHUB_ENABLED = ORIGINAL_GH;
});

const { GET } = await import("./route");

describe("GET /api/github/installations gating", () => {
  it("returns 403 with provider_disabled body when GITHUB_ENABLED=false", async () => {
    process.env.GITHUB_ENABLED = "false";

    const response = await GET();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({
      error: "provider_disabled",
      provider: "github",
    });
  });

  it("returns 200 when GITHUB_ENABLED is unset (default true)", async () => {
    delete process.env.GITHUB_ENABLED;

    const response = await GET();

    expect(response.status).toBe(200);
  });
});
