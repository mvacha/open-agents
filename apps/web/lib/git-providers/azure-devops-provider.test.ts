import { describe, expect, it, mock } from "bun:test";
import type { RepoRef } from "./types";

mock.module("server-only", () => ({}));

const modulePromise = import("./azure-devops-provider");

const adoRef: RepoRef = {
  provider: "azure_devops",
  org: "contoso",
  project: "Acme Platform",
  repo: "my-repo",
};

describe("azureDevOpsProvider", () => {
  it("has id 'azure_devops'", async () => {
    const { azureDevOpsProvider } = await modulePromise;
    expect(azureDevOpsProvider.id).toBe("azure_devops");
  });

  it("validates a valid ADO ref", async () => {
    const { azureDevOpsProvider } = await modulePromise;
    expect(azureDevOpsProvider.validateRepoIdentifiers(adoRef)).toBe(true);
  });

  it("rejects a github ref", async () => {
    const { azureDevOpsProvider } = await modulePromise;
    expect(
      azureDevOpsProvider.validateRepoIdentifiers({
        provider: "github",
        owner: "x",
        repo: "y",
      }),
    ).toBe(false);
  });

  it("buildAuthRemoteUrl produces an encoded ADO URL", async () => {
    const { azureDevOpsProvider } = await modulePromise;
    const url = azureDevOpsProvider.buildAuthRemoteUrl({
      token: "pat",
      ref: adoRef,
    });
    expect(url).toBe(
      "https://anything:pat@dev.azure.com/contoso/Acme%20Platform/_git/my-repo",
    );
  });

  it("buildPullRequestUrl produces ADO format", async () => {
    const { azureDevOpsProvider } = await modulePromise;
    expect(azureDevOpsProvider.buildPullRequestUrl(adoRef, 42)).toBe(
      "https://dev.azure.com/contoso/Acme%20Platform/_git/my-repo/pullrequest/42",
    );
  });
});
