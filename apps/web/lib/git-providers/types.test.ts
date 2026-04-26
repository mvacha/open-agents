import { describe, expect, it } from "bun:test";
import { repoMetaSchema, type RepoMeta } from "./types";

describe("repoMetaSchema", () => {
  it("accepts a github meta with no extra fields", () => {
    const parsed = repoMetaSchema.parse({ provider: "github" });
    expect(parsed).toEqual({ provider: "github" });
  });

  it("accepts an azure_devops meta with project", () => {
    const parsed = repoMetaSchema.parse({
      provider: "azure_devops",
      project: "AcmePlatform",
    });
    expect(parsed.provider).toBe("azure_devops");
    if (parsed.provider === "azure_devops") {
      expect(parsed.project).toBe("AcmePlatform");
    }
  });

  it("rejects azure_devops meta without project", () => {
    expect(() => repoMetaSchema.parse({ provider: "azure_devops" })).toThrow();
  });

  it("rejects unknown provider", () => {
    expect(() => repoMetaSchema.parse({ provider: "gitlab" })).toThrow();
  });

  it("type narrows correctly", () => {
    const meta: RepoMeta = { provider: "azure_devops", project: "X" };
    if (meta.provider === "azure_devops") {
      expect(meta.project).toBe("X");
    }
  });
});
