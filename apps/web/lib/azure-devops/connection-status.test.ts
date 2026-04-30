import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const modulePromise = import("./connection-status");

const ENV = {
  enabled: process.env.AZURE_DEVOPS_ENABLED,
  org: process.env.AZURE_DEVOPS_ORG,
  pat: process.env.AZURE_DEVOPS_PAT,
};

afterEach(() => {
  process.env.AZURE_DEVOPS_ENABLED = ENV.enabled;
  process.env.AZURE_DEVOPS_ORG = ENV.org;
  process.env.AZURE_DEVOPS_PAT = ENV.pat;
  (async () => {
    const { __resetAdoConnectionStatusCacheForTesting } = await modulePromise;
    __resetAdoConnectionStatusCacheForTesting();
  })();
});

describe("getAdoConnectionStatus", () => {
  it("returns enabled:false when provider flag is not set", async () => {
    delete process.env.AZURE_DEVOPS_ENABLED;
    const { getAdoConnectionStatus } = await modulePromise;
    const status = await getAdoConnectionStatus();
    expect(status).toEqual({ enabled: false });
  });

  it("returns missing_org_or_pat when flag is on but config missing", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    delete process.env.AZURE_DEVOPS_ORG;
    delete process.env.AZURE_DEVOPS_PAT;
    const { getAdoConnectionStatus } = await modulePromise;
    const status = await getAdoConnectionStatus();
    expect(status).toEqual({
      enabled: true,
      healthy: false,
      reason: "missing_org_or_pat",
      org: null,
    });
  });

  it("returns enabled+healthy via injected probe", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    process.env.AZURE_DEVOPS_ORG = "contoso";
    process.env.AZURE_DEVOPS_PAT = "pat";
    const { getAdoConnectionStatus } = await modulePromise;
    const status = await getAdoConnectionStatus({
      probe: async () => ({ ok: true }),
    });
    expect(status).toEqual({ enabled: true, healthy: true, org: "contoso" });
  });

  it("returns unhealthy with reason when probe fails", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    process.env.AZURE_DEVOPS_ORG = "contoso";
    process.env.AZURE_DEVOPS_PAT = "pat";
    const { getAdoConnectionStatus } = await modulePromise;
    const status = await getAdoConnectionStatus({
      probe: async () => ({ ok: false, reason: "pat_invalid" }),
    });
    expect(status).toEqual({
      enabled: true,
      healthy: false,
      reason: "pat_invalid",
      org: "contoso",
    });
  });
});
