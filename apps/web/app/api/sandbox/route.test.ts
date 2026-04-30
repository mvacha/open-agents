import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "vercel" };
  repoOwner?: string | null;
  repoName?: string | null;
  repoProvider?: "github" | "azure_devops";
  repoMeta?: unknown;
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamId: string | null;
  globalSkillRefs: Array<{ source: string; skillName: string }>;
}

interface TestVercelAuthInfo {
  token: string;
  expiresAt: number;
  externalId: string;
}

interface KickCall {
  sessionId: string;
  reason: string;
}

interface ConnectConfig {
  state: {
    type: "vercel";
    sandboxName?: string;
    source?: {
      repo?: string;
      branch?: string;
      newBranch?: string;
    };
  };
  options?: {
    env?: Record<string, string>;
    githubToken?: string;
    gitUser?: {
      email?: string;
    };
    persistent?: boolean;
    resume?: boolean;
    createIfMissing?: boolean;
  };
}

const kickCalls: KickCall[] = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectConfigs: ConnectConfig[] = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];
const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
  [];
const dotenvSyncCalls: Array<Record<string, unknown>> = [];
const defaultBranchCalls: Array<{ branch?: string }> = [];
const fetchConfigCalls: Array<{ branch: string }> = [];

let sessionRecord: TestSessionRecord;
let currentVercelAuthInfo: TestVercelAuthInfo | null;
let currentGitHubToken: string | null;
let currentDotenvContent: string;
let currentDotenvError: Error | null;
let currentGitProviderToken: string | null;
let currentDefaultBranch: string;
let currentOpenAgentsConfig:
  | {
      kind: "missing";
    }
  | {
      kind: "ok";
      config: {
        dev: Array<{ name: string; run: string; port: number; cwd: string }>;
        env?: Record<string, string>;
      };
    };

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: {
      id: "user-1",
      username: "nico",
      name: "Nico",
      email: "nico@example.com",
    },
  }),
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => ({
    externalUserId: "12345",
    username: "nico-gh",
    accessToken: "token",
    refreshToken: null,
    expiresAt: null,
  }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => currentGitHubToken,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelAuthInfo: async () => currentVercelAuthInfo,
  getUserVercelToken: async () => currentVercelAuthInfo?.token ?? null,
}));

mock.module("@/lib/vercel/projects", () => ({
  buildDevelopmentDotenvFromVercelProject: async (
    input: Record<string, unknown>,
  ) => {
    dotenvSyncCalls.push(input);
    if (currentDotenvError) {
      throw currentDotenvError;
    }
    return currentDotenvContent;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => sessionRecord,
  markSessionHibernatingIfNoActiveStreams: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    return {
      ...sessionRecord,
      ...patch,
    };
  },
}));

const testGitProvider = {
  getCloneToken: async () => currentGitProviderToken,
  getDefaultBranch: async () => {
    defaultBranchCalls.push({});
    return currentDefaultBranch;
  },
  buildAuthRemoteUrl: ({
    token,
    ref,
  }: {
    token: string;
    ref: { provider: string; org?: string; project?: string; repo?: string };
  }) =>
    ref.provider === "azure_devops"
      ? `https://token:${token}@dev.azure.com/${ref.org}/${ref.project}/_git/${ref.repo}`
      : undefined,
};

mock.module("@/lib/git-providers/resolve", () => ({
  getProviderById: () => testGitProvider,
  getProviderForSession: () => testGitProvider,
  sessionToRepoRef: (session: {
    repoOwner?: string | null;
    repoName?: string | null;
    repoProvider?: "github" | "azure_devops";
    repoMeta?: unknown;
  }) => {
    if (!(session.repoOwner && session.repoName)) {
      return null;
    }
    if (session.repoProvider === "azure_devops") {
      const meta = session.repoMeta as { project?: string } | null;
      return {
        provider: "azure_devops",
        org: session.repoOwner,
        project: meta?.project ?? "Project",
        repo: session.repoName,
      };
    }
    return {
      provider: "github",
      owner: session.repoOwner,
      repo: session.repoName,
    };
  },
}));

mock.module("@/lib/open-agents-config/fetch", () => ({
  envFromConfig: (config: { env?: Record<string, string> }) => config.env,
  fetchOpenAgentsConfigFromProvider: async (args: { branch: string }) => {
    fetchConfigCalls.push({ branch: args.branch });
    return currentOpenAgentsConfig;
  },
  uniquePortsFromConfig: (config: { dev: Array<{ port: number }> }) =>
    Array.from(new Set(config.dev.map((process) => process.port))),
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: KickCall) => {
    kickCalls.push(input);
  },
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (
    configOrState: ConnectConfig | ConnectConfig["state"],
    options?: ConnectConfig["options"],
  ) => {
    const config =
      "state" in configOrState
        ? configOrState
        : { state: configOrState, options };
    connectConfigs.push(config);

    return {
      currentBranch: "main",
      workingDirectory: "/vercel/sandbox",
      getState: () => ({
        type: "vercel" as const,
        sandboxName: config.state.sandboxName ?? "session_session-1",
        expiresAt: Date.now() + 120_000,
      }),
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        execCalls.push({ command, cwd, timeoutMs });
        if (command === 'printf %s "$HOME"') {
          return {
            success: true,
            exitCode: 0,
            stdout: "/root",
            stderr: "",
            truncated: false,
          };
        }

        return {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          truncated: false,
        };
      },
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path, content });
      },
      stop: async () => {},
    };
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox lifecycle kicks", () => {
  beforeEach(() => {
    kickCalls.length = 0;
    updateCalls.length = 0;
    connectConfigs.length = 0;
    writeFileCalls.length = 0;
    execCalls.length = 0;
    dotenvSyncCalls.length = 0;
    defaultBranchCalls.length = 0;
    fetchConfigCalls.length = 0;
    currentVercelAuthInfo = {
      token: "vercel-token",
      expiresAt: 1_700_000_000,
      externalId: "user_ext_1",
    };
    currentGitHubToken = null;
    currentDotenvContent = 'API_KEY="secret"\n';
    currentDotenvError = null;
    currentGitProviderToken = "provider-token";
    currentDefaultBranch = "main";
    currentOpenAgentsConfig = { kind: "missing" };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      vercelProjectId: "project-1",
      vercelProjectName: "open-harness-web",
      vercelTeamId: "team-1",
      globalSkillRefs: [],
    };
  });

  test("uses session_<sessionId> as the persistent sandbox name", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvContent = "";
    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      options: {
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
    expect(dotenvSyncCalls).toHaveLength(0);
  });

  test("repo sandboxes broker the user GitHub token instead of embedding it", async () => {
    const { POST } = await routeModulePromise;

    currentGitHubToken = "github-user-token";
    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: "https://github.com/acme/private-repo",
          branch: "main",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        source: {
          repo: "https://github.com/acme/private-repo",
          branch: "main",
        },
      },
      options: {
        githubToken: "github-user-token",
      },
    });
    expect(connectConfigs[0]?.state.source).not.toHaveProperty("token");
  });

  test("loads config env from the default branch when creating a new branch", async () => {
    const { POST } = await routeModulePromise;

    currentGitHubToken = "github-user-token";
    currentDefaultBranch = "trunk";
    currentOpenAgentsConfig = {
      kind: "ok",
      config: {
        dev: [{ name: "web", run: "bun run dev", port: 4321, cwd: "." }],
        env: {
          VITE_PUBLIC_API_URL: "https://api.example.test",
        },
      },
    };
    sessionRecord = {
      ...sessionRecord,
      repoOwner: "acme",
      repoName: "private-repo",
      repoProvider: "github",
      repoMeta: null,
    };

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          repoUrl: "https://github.com/acme/private-repo",
          branch: "open-agents/session-1",
          isNewBranch: true,
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(defaultBranchCalls).toHaveLength(1);
    expect(fetchConfigCalls).toEqual([{ branch: "trunk" }]);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        source: {
          repo: "https://github.com/acme/private-repo",
          newBranch: "open-agents/session-1",
        },
      },
      options: {
        env: {
          VITE_PUBLIC_API_URL: "https://api.example.test",
        },
      },
    });
    expect(connectConfigs[0]?.state.source?.branch).toBeUndefined();
  });

  test("new vercel sandbox does not sync linked Development env vars while code is commented out", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(connectConfigs[0]?.options?.gitUser?.email).toBe(
      "12345+nico-gh@users.noreply.github.com",
    );
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([
      {
        path: "/root/.local/share/com.vercel.cli/auth.json",
        content:
          '{\n  "token": "vercel-token",\n  "expiresAt": 1700000000\n}\n',
      },
      {
        path: "/vercel/sandbox/.vercel/project.json",
        content:
          '{\n  "orgId": "team-1",\n  "projectId": "project-1",\n  "projectName": "open-harness-web"\n}\n',
      },
    ]);

    const payload = (await response.json()) as {
      timeout: number;
      mode: string;
    };
    expect(payload.timeout).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    expect(payload.mode).toBe("vercel");
  });

  test("commented-out env sync does not run during sandbox creation", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvError = new Error("boom");

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([
      {
        path: "/root/.local/share/com.vercel.cli/auth.json",
        content:
          '{\n  "token": "vercel-token",\n  "expiresAt": 1700000000\n}\n',
      },
      {
        path: "/vercel/sandbox/.vercel/project.json",
        content:
          '{\n  "orgId": "team-1",\n  "projectId": "project-1",\n  "projectName": "open-harness-web"\n}\n',
      },
    ]);
  });

  test("new sandboxes install global skills", async () => {
    const { POST } = await routeModulePromise;

    sessionRecord.globalSkillRefs = [
      { source: "vercel/ai", skillName: "ai-sdk" },
    ];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(execCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'printf %s "$HOME"' }),
        expect.objectContaining({
          command:
            "HOME='/root' npx skills add 'vercel/ai' --skill 'ai-sdk' --agent amp -g -y --copy",
        }),
      ]),
    );
  });

  test("rejects unsupported sandbox types", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "invalid",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid sandbox type");
    expect(connectConfigs).toHaveLength(0);
    expect(kickCalls).toHaveLength(0);
  });
});
