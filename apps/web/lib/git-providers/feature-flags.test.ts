import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const modulePromise = import("./feature-flags");

const ORIGINAL_AZ = process.env.AZURE_DEVOPS_ENABLED;
const ORIGINAL_GH = process.env.GITHUB_ENABLED;

afterEach(() => {
  process.env.AZURE_DEVOPS_ENABLED = ORIGINAL_AZ;
  process.env.GITHUB_ENABLED = ORIGINAL_GH;
});

describe("feature flags", () => {
  it("AZURE_DEVOPS_ENABLED defaults to false", async () => {
    delete process.env.AZURE_DEVOPS_ENABLED;
    const { isAzureDevOpsEnabled } = await modulePromise;
    expect(isAzureDevOpsEnabled()).toBe(false);
  });

  it("AZURE_DEVOPS_ENABLED=true is true", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "true";
    const { isAzureDevOpsEnabled } = await modulePromise;
    expect(isAzureDevOpsEnabled()).toBe(true);
  });

  it("AZURE_DEVOPS_ENABLED=false is false", async () => {
    process.env.AZURE_DEVOPS_ENABLED = "false";
    const { isAzureDevOpsEnabled } = await modulePromise;
    expect(isAzureDevOpsEnabled()).toBe(false);
  });

  it("GITHUB_ENABLED defaults to true", async () => {
    delete process.env.GITHUB_ENABLED;
    const { isGitHubEnabled } = await modulePromise;
    expect(isGitHubEnabled()).toBe(true);
  });

  it("GITHUB_ENABLED=false is false", async () => {
    process.env.GITHUB_ENABLED = "false";
    const { isGitHubEnabled } = await modulePromise;
    expect(isGitHubEnabled()).toBe(false);
  });

  it("GITHUB_ENABLED=true is true", async () => {
    process.env.GITHUB_ENABLED = "true";
    const { isGitHubEnabled } = await modulePromise;
    expect(isGitHubEnabled()).toBe(true);
  });
});
