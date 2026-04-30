import { describe, expect, it } from "bun:test";
import {
  buildAdoAuthRemoteUrl,
  buildAdoRepoWebUrl,
  buildAdoPullRequestUrl,
  isValidAdoIdentifier,
} from "./repo-identifiers";

describe("isValidAdoIdentifier", () => {
  it("accepts simple alphanumeric", () => {
    expect(isValidAdoIdentifier("contoso")).toBe(true);
  });
  it("accepts spaces, dots, dashes, underscores", () => {
    expect(isValidAdoIdentifier("Acme Platform")).toBe(true);
    expect(isValidAdoIdentifier("My_Repo-2.0")).toBe(true);
  });
  it("rejects empty", () => {
    expect(isValidAdoIdentifier("")).toBe(false);
  });
  it("rejects newlines and tabs", () => {
    expect(isValidAdoIdentifier("foo\nbar")).toBe(false);
    expect(isValidAdoIdentifier("foo\tbar")).toBe(false);
  });
  it("rejects forward slash (path traversal)", () => {
    expect(isValidAdoIdentifier("foo/bar")).toBe(false);
  });
});

describe("buildAdoAuthRemoteUrl", () => {
  it("encodes each segment", () => {
    const url = buildAdoAuthRemoteUrl({
      token: "abc:123",
      org: "contoso",
      project: "Acme Platform",
      repo: "my-repo",
    });
    expect(url).toBe(
      "https://anything:abc%3A123@dev.azure.com/contoso/Acme%20Platform/_git/my-repo",
    );
  });

  it("returns null when an identifier is invalid", () => {
    expect(
      buildAdoAuthRemoteUrl({
        token: "t",
        org: "ok",
        project: "ok",
        repo: "bad/slash",
      }),
    ).toBeNull();
  });
});

describe("buildAdoRepoWebUrl", () => {
  it("builds the repo web URL with encoded segments", () => {
    expect(
      buildAdoRepoWebUrl({
        org: "contoso",
        project: "Acme Platform",
        repo: "my-repo",
      }),
    ).toBe("https://dev.azure.com/contoso/Acme%20Platform/_git/my-repo");
  });
});

describe("buildAdoPullRequestUrl", () => {
  it("builds the PR URL", () => {
    expect(
      buildAdoPullRequestUrl(
        { org: "contoso", project: "Acme", repo: "my-repo" },
        42,
      ),
    ).toBe("https://dev.azure.com/contoso/Acme/_git/my-repo/pullrequest/42");
  });
});
