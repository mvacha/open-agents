import { checkBotId } from "botid/server";
import { botIdConfig } from "@/lib/botid";
import {
  type ConnectOptions,
  // eslint-disable-next-line no-restricted-imports -- creation path; the wrapper is used below when a sessionId is available.
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { getGitHubAccount } from "@/lib/db/accounts";
import { updateSession } from "@/lib/db/sessions";
import {
  getProviderById,
  getProviderForSession,
  sessionToRepoRef,
} from "@/lib/git-providers/resolve";
import { parseGitHubUrl } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";
import {
  envFromConfig,
  fetchOpenAgentsConfigFromProvider,
  uniquePortsFromConfig,
} from "@/lib/open-agents-config/fetch";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { connectSandboxForSession } from "@/lib/sandbox/connect";
import {
  getVercelCliSandboxSetup,
  syncVercelCliAuthToSandbox,
} from "@/lib/sandbox/vercel-cli-auth";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import {
  canOperateOnSandbox,
  clearSandboxState,
  getSessionSandboxName,
  hasResumableSandboxState,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
// import { buildDevelopmentDotenvFromVercelProject } from "@/lib/vercel/projects";
// import { getUserVercelToken } from "@/lib/vercel/token";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  sessionId?: string;
  sandboxType?: "vercel";
}

// async function syncVercelProjectEnvVarsToSandbox(params: {
//   userId: string;
//   sessionRecord: SessionRecord;
//   sandbox: Sandbox;
// }): Promise<void> {
//   if (!params.sessionRecord.vercelProjectId) {
//     return;
//   }
//
//   const token = await getUserVercelToken(params.userId);
//   if (!token) {
//     return;
//   }
//
//   const dotenvContent = await buildDevelopmentDotenvFromVercelProject({
//     token,
//     projectIdOrName: params.sessionRecord.vercelProjectId,
//     teamId: params.sessionRecord.vercelTeamId,
//   });
//   if (!dotenvContent) {
//     return;
//   }
//
//   await params.sandbox.writeFile(
//     `${params.sandbox.workingDirectory}/.env.local`,
//     dotenvContent,
//     "utf-8",
//   );
// }

async function syncVercelCliAuthForSandbox(params: {
  userId: string;
  sessionRecord: SessionRecord;
  sandbox: Sandbox;
}): Promise<void> {
  const setup = await getVercelCliSandboxSetup({
    userId: params.userId,
    sessionRecord: params.sessionRecord,
  });

  await syncVercelCliAuthToSandbox({
    sandbox: params.sandbox,
    setup,
  });
}

interface ResolvedSandboxConfig {
  ports: number[];
  env?: Record<string, string>;
  configWarning?: { kind: "invalid" | "error"; error: string };
}

async function resolveSandboxConfig(params: {
  sessionRecord: SessionRecord | undefined;
  branch: string;
  isNewBranch: boolean;
  userId: string;
}): Promise<ResolvedSandboxConfig> {
  const { sessionRecord, branch } = params;
  if (!sessionRecord) {
    return { ports: DEFAULT_SANDBOX_PORTS };
  }

  const ref = sessionToRepoRef({
    repoOwner: sessionRecord.repoOwner,
    repoName: sessionRecord.repoName,
    repoProvider: sessionRecord.repoProvider,
    repoMeta: sessionRecord.repoMeta,
  });
  if (!ref) {
    return { ports: DEFAULT_SANDBOX_PORTS };
  }

  const provider = getProviderForSession({
    repoOwner: sessionRecord.repoOwner,
    repoName: sessionRecord.repoName,
    repoProvider: sessionRecord.repoProvider,
    repoMeta: sessionRecord.repoMeta,
  });

  const token = await provider.getCloneToken(params.userId);
  if (!token) {
    return { ports: DEFAULT_SANDBOX_PORTS };
  }

  let configBranch = branch;
  if (params.isNewBranch) {
    configBranch =
      (await provider
        .getDefaultBranch({
          ref,
          token,
        })
        .catch(() => null)) ?? "main";
  }

  const result = await fetchOpenAgentsConfigFromProvider({
    provider,
    ref,
    branch: configBranch,
    token,
  });

  if (result.kind === "ok") {
    return {
      ports: uniquePortsFromConfig(result.config),
      env: envFromConfig(result.config),
    };
  }

  if (result.kind === "invalid") {
    console.warn(
      `[sandbox] .open-agents/config.json is invalid; falling back to default ports: ${result.error}`,
    );
    return {
      ports: DEFAULT_SANDBOX_PORTS,
      configWarning: { kind: "invalid", error: result.error },
    };
  }

  if (result.kind === "error") {
    console.warn(
      `[sandbox] failed to pre-fetch .open-agents/config.json; falling back to default ports: ${result.error}`,
    );
    return {
      ports: DEFAULT_SANDBOX_PORTS,
      configWarning: { kind: "error", error: result.error },
    };
  }

  return { ports: DEFAULT_SANDBOX_PORTS };
}

async function installSessionGlobalSkills(params: {
  sessionRecord: SessionRecord;
  sandbox: Sandbox;
}): Promise<void> {
  const globalSkillRefs = params.sessionRecord.globalSkillRefs ?? [];
  if (globalSkillRefs.length === 0) {
    return;
  }

  await installGlobalSkills({
    sandbox: params.sandbox,
    globalSkillRefs,
  });
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  const { repoUrl, branch = "main", isNewBranch = false, sessionId } = body;

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotId(botIdConfig);
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  // Validate session ownership first so we know which provider to use.
  let sessionRecord: SessionRecord | undefined;
  if (sessionId) {
    const sessionContext = await requireOwnedSession({
      userId: session.user.id,
      sessionId,
    });
    if (!sessionContext.ok) {
      return sessionContext.response;
    }

    sessionRecord = sessionContext.sessionRecord;
  }

  const isAdoRepo =
    sessionRecord?.repoProvider === "azure_devops" ||
    (typeof repoUrl === "string" &&
      /^https:\/\/dev\.azure\.com\//.test(repoUrl));

  let resolvedRepoUrl = repoUrl;
  let githubToken: string | null = null;
  if (isAdoRepo) {
    if (!sessionRecord) {
      return Response.json(
        { error: "Azure DevOps sandboxes require an existing session" },
        { status: 400 },
      );
    }
    const provider = getProviderById("azure_devops");
    const ref = sessionToRepoRef(sessionRecord);
    if (!ref || ref.provider !== "azure_devops") {
      return Response.json(
        { error: "Session is missing Azure DevOps repository metadata" },
        { status: 400 },
      );
    }
    const token = await provider.getCloneToken(session.user.id);
    if (!token) {
      return Response.json(
        { error: "Azure DevOps is not configured on the server" },
        { status: 403 },
      );
    }
    const authUrl = provider.buildAuthRemoteUrl({ token, ref });
    if (!authUrl) {
      return Response.json(
        { error: "Failed to build Azure DevOps clone URL" },
        { status: 400 },
      );
    }
    resolvedRepoUrl = authUrl;
  } else {
    githubToken = await getUserGitHubToken(session.user.id);

    if (repoUrl) {
      const parsedRepo = parseGitHubUrl(repoUrl);
      if (!parsedRepo) {
        return Response.json(
          { error: "Invalid GitHub repository URL" },
          { status: 400 },
        );
      }

      if (!githubToken) {
        return Response.json(
          { error: "Connect GitHub to access repositories" },
          { status: 403 },
        );
      }
    }
  }

  const sandboxName = sessionId ? getSessionSandboxName(sessionId) : undefined;
  const githubAccount = await getGitHubAccount(session.user.id);
  const githubNoreplyEmail =
    githubAccount?.externalUserId && githubAccount.username
      ? `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`
      : undefined;

  const gitUser = {
    name: session.user.name ?? githubAccount?.username ?? session.user.username,
    email:
      githubNoreplyEmail ??
      session.user.email ??
      `${session.user.username}@users.noreply.github.com`,
  };

  // ============================================
  // CREATE OR RESUME: Create a named persistent sandbox for this session.
  // ============================================
  const startTime = Date.now();

  const source = resolvedRepoUrl
    ? {
        repo: resolvedRepoUrl,
        branch: isNewBranch ? undefined : branch,
        newBranch: isNewBranch ? branch : undefined,
      }
    : undefined;

  const { ports, env, configWarning } = await resolveSandboxConfig({
    sessionRecord,
    branch,
    isNewBranch,
    userId: session.user.id,
  });

  const state: SandboxState = {
    type: "vercel",
    ...(sandboxName ? { sandboxName } : {}),
    source,
  };
  const connectOptions: ConnectOptions = {
    githubToken: githubToken ?? undefined,
    gitUser,
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    ports,
    ...(env ? { env } : {}),
    baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    persistent: !!sandboxName,
    resume: !!sandboxName,
    createIfMissing: !!sandboxName,
  };

  const sandbox = sessionId
    ? await connectSandboxForSession(state, sessionId, connectOptions)
    : await connectSandbox(state, connectOptions);

  if (sessionId && sandbox.getState) {
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(sessionId, {
      sandboxState: nextState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(
        sessionRecord?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(nextState),
    });

    if (sessionRecord) {
      // TODO: Re-enable this once we have a solid exfiltration defense strategy.
      // try {
      //   await syncVercelProjectEnvVarsToSandbox({
      //     userId: session.user.id,
      //     sessionRecord,
      //     sandbox,
      //   });
      // } catch (error) {
      //   console.error(
      //     `Failed to sync Vercel env vars for session ${sessionRecord.id}:`,
      //     error,
      //   );
      // }

      try {
        await syncVercelCliAuthForSandbox({
          userId: session.user.id,
          sessionRecord,
          sandbox,
        });
      } catch (error) {
        console.error(
          `Failed to prepare Vercel CLI auth for session ${sessionRecord.id}:`,
          error,
        );
      }

      try {
        await installSessionGlobalSkills({
          sessionRecord,
          sandbox,
        });
      } catch (error) {
        console.error(
          `Failed to install global skills for session ${sessionRecord.id}:`,
          error,
        );
      }
    }

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "sandbox-created",
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    currentBranch: repoUrl ? branch : undefined,
    mode: "vercel",
    timing: { readyMs },
    ...(configWarning ? { configWarning } : {}),
  });
}

export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("sessionId" in body) ||
    typeof (body as Record<string, unknown>).sessionId !== "string"
  ) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const { sessionId } = body as { sessionId: string };

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  // If there's no sandbox to stop, return success (idempotent)
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ success: true, alreadyStopped: true });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandboxForSession(
    sessionRecord.sandboxState,
    sessionId,
  );
  await sandbox.stop();

  const clearedState = clearSandboxState(sessionRecord.sandboxState);
  await updateSession(sessionId, {
    sandboxState: clearedState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleState:
      hasResumableSandboxState(clearedState) || !!sessionRecord.snapshotUrl
        ? "hibernated"
        : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  return Response.json({ success: true });
}
