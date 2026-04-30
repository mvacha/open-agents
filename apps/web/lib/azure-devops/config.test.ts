import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const modulePromise = import("./config");

const ORIGINAL = {
  enabled: process.env.AZURE_DEVOPS_ENABLED,
  org: process.env.AZURE_DEVOPS_ORG,
  pat: process.env.AZURE_DEVOPS_PAT,
};

afterEach(() => {
  process.env.AZURE_DEVOPS_ENABLED = ORIGINAL.enabled;
  process.env.AZURE_DEVOPS_ORG = ORIGINAL.org;
  process.env.AZURE_DEVOPS_PAT = ORIGINAL.pat;
});

describe("getAzureDevOpsConfig", () => {
  it("returns disabled when AZURE_DEVOPS_ENABLED is unset", async () => {
    delete process.env.AZURE_DEVOPS_ENABLED;
    process.env.AZURE_DEVOPS_ORG = "contoso";
    process.env.AZURE_DEVOPS_PAT = "pat";
    const { getAzureDevOpsConfig } = await modulePromise;
    expect(getAzureDevOpsConfig()).toEqual({ enabled: false });
  });

  it("returns disabled when ORG missing", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    delete process.env.AZURE_DEVOPS_ORG;
    process.env.AZURE_DEVOPS_PAT = "pat";
    const { getAzureDevOpsConfig } = await modulePromise;
    expect(getAzureDevOpsConfig().enabled).toBe(false);
  });

  it("returns disabled when PAT missing", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    process.env.AZURE_DEVOPS_ORG = "contoso";
    delete process.env.AZURE_DEVOPS_PAT;
    const { getAzureDevOpsConfig } = await modulePromise;
    expect(getAzureDevOpsConfig().enabled).toBe(false);
  });

  it("returns enabled config when all env vars present", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    process.env.AZURE_DEVOPS_ORG = "contoso";
    process.env.AZURE_DEVOPS_PAT = "secret-pat";
    const { getAzureDevOpsConfig } = await modulePromise;
    expect(getAzureDevOpsConfig()).toEqual({
      enabled: true,
      org: "contoso",
      pat: "secret-pat",
    });
  });

  it("trims whitespace in env values", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    process.env.AZURE_DEVOPS_ORG = "  contoso  ";
    process.env.AZURE_DEVOPS_PAT = "  pat  ";
    const { getAzureDevOpsConfig } = await modulePromise;
    expect(getAzureDevOpsConfig()).toEqual({
      enabled: true,
      org: "contoso",
      pat: "pat",
    });
  });
});
