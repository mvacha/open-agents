import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "u1" } }),
}));

let nextStatus:
  | { enabled: false }
  | { enabled: true; healthy: true }
  | {
      enabled: true;
      healthy: false;
      reason: "pat_invalid" | "pat_insufficient_scope" | "network_error";
    } = { enabled: false };

mock.module("@/lib/azure-devops/connection-status", () => ({
  getAdoConnectionStatus: async () => nextStatus,
  __resetAdoConnectionStatusCacheForTesting: () => {},
}));

afterEach(() => {
  nextStatus = { enabled: false };
});

const { GET } = await import("./route");

describe("GET /api/azure-devops/connection-status", () => {
  it("returns { enabled: false } when provider disabled (200, never 403)", async () => {
    nextStatus = { enabled: false };

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });

  it("returns enabled+healthy", async () => {
    nextStatus = { enabled: true, healthy: true };

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, healthy: true });
  });

  it("returns unhealthy with reason when probe fails", async () => {
    nextStatus = { enabled: true, healthy: false, reason: "pat_invalid" };

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      healthy: false,
      reason: "pat_invalid",
    });
  });
});
