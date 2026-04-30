import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let getUserGitHubTokenCalls = 0;
let connectSandboxCalls: Array<{ githubToken?: string }> = [];

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => {
    getUserGitHubTokenCalls += 1;
    return "ghp_token";
  },
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (_state: unknown, opts: { githubToken?: string }) => {
    connectSandboxCalls.push({ githubToken: opts?.githubToken });
    return {
      workingDirectory: "/sandbox",
      exec: async () => ({ success: true, stdout: "", stderr: "" }),
      getState: () => ({ type: "vercel" }),
    };
  },
}));

mock.module("@open-harness/agent", () => ({
  discoverSkills: async () => [],
}));

mock.module("@/lib/sandbox/vercel-cli-auth", () => ({
  getVercelCliSandboxSetup: async () => null,
  syncVercelCliAuthToSandbox: async () => undefined,
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_PORTS: [],
  DEFAULT_SANDBOX_TIMEOUT_MS: 60_000,
}));

mock.module("@/lib/skills/directories", () => ({
  getSandboxSkillDirectories: async () => [],
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => [],
  setCachedSkills: async () => undefined,
}));

const { createChatRuntime } = await import("./runtime");

describe("createChatRuntime — provider-aware credential brokering", () => {
  test("does not fetch GitHub token for ADO sessions", async () => {
    getUserGitHubTokenCalls = 0;
    connectSandboxCalls = [];

    await createChatRuntime({
      userId: "u1",
      sessionId: "s1",
      sessionRecord: {
        repoProvider: "azure_devops",
        sandboxState: { type: "vercel" },
      } as never,
    });

    expect(getUserGitHubTokenCalls).toBe(0);
    expect(connectSandboxCalls[0]?.githubToken).toBeUndefined();
  });

  test("fetches and forwards GitHub token for GitHub sessions", async () => {
    getUserGitHubTokenCalls = 0;
    connectSandboxCalls = [];

    await createChatRuntime({
      userId: "u1",
      sessionId: "s1",
      sessionRecord: {
        repoProvider: "github",
        sandboxState: { type: "vercel" },
      } as never,
    });

    expect(getUserGitHubTokenCalls).toBe(1);
    expect(connectSandboxCalls[0]?.githubToken).toBe("ghp_token");
  });
});
