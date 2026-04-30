import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "u1" } }),
}));

let nextStatus:
  | { enabled: false }
  | { enabled: true; healthy: true; org: string }
  | {
      enabled: true;
      healthy: false;
      reason:
        | "missing_org_or_pat"
        | "pat_invalid"
        | "pat_insufficient_scope"
        | "network_error";
      org: string | null;
    } = { enabled: false };

let lastBypassCache: boolean | undefined;
mock.module("@/lib/azure-devops/connection-status", () => ({
  getAdoConnectionStatus: async (opts?: { bypassCache?: boolean }) => {
    lastBypassCache = opts?.bypassCache;
    return nextStatus;
  },
  __resetAdoConnectionStatusCacheForTesting: () => {},
}));

afterEach(() => {
  nextStatus = { enabled: false };
});

const { GET } = await import("./route");

describe("GET /api/azure-devops/connection-status", () => {
  it("returns { enabled: false } when provider disabled (200, never 403)", async () => {
    nextStatus = { enabled: false };

    const response = await GET(
      new Request("http://localhost/api/azure-devops/connection-status"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });

  it("returns enabled+healthy", async () => {
    nextStatus = { enabled: true, healthy: true, org: "contoso" };

    const response = await GET(
      new Request("http://localhost/api/azure-devops/connection-status"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      healthy: true,
      org: "contoso",
    });
  });

  it("returns unhealthy with reason when probe fails", async () => {
    nextStatus = {
      enabled: true,
      healthy: false,
      reason: "pat_invalid",
      org: "contoso",
    };

    const response = await GET(
      new Request("http://localhost/api/azure-devops/connection-status"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      healthy: false,
      reason: "pat_invalid",
      org: "contoso",
    });
  });

  it("forwards bypassCache when fresh=1 query param is set", async () => {
    nextStatus = { enabled: true, healthy: true, org: "contoso" };
    lastBypassCache = undefined;

    await GET(
      new Request(
        "http://localhost/api/azure-devops/connection-status?fresh=1",
      ),
    );
    expect(lastBypassCache as boolean | undefined).toBe(true);

    await GET(
      new Request("http://localhost/api/azure-devops/connection-status"),
    );
    expect(lastBypassCache as boolean | undefined).toBe(false);
  });
});
