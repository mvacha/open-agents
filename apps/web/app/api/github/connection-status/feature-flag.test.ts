import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "u1" } }),
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => null,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => [],
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/github/installations-sync", () => ({
  isGitHubInstallationsAuthError: () => false,
  syncUserInstallations: async () => 0,
}));

const ORIGINAL_GH = process.env.GITHUB_ENABLED;

afterEach(() => {
  process.env.GITHUB_ENABLED = ORIGINAL_GH;
});

const { GET } = await import("./route");

describe("GET /api/github/connection-status feature-flag behavior", () => {
  it("returns { enabled: false } and 200 when GITHUB_ENABLED=false", async () => {
    process.env.GITHUB_ENABLED = "false";

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ enabled: false });
  });

  it("returns the regular status payload (200) when GITHUB_ENABLED is unset", async () => {
    delete process.env.GITHUB_ENABLED;

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    // The handler returns its existing status shape; just assert it isn't the disabled shape.
    expect(body).not.toEqual({ enabled: false });
  });
});
