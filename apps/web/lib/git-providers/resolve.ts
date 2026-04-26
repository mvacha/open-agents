import "server-only";
import { azureDevOpsProvider } from "./azure-devops-provider";
import { gitHubProvider } from "./github-provider";
import {
  type GitProvider,
  type RepoMeta,
  type RepoProviderId,
  type RepoRef,
  repoMetaSchema,
} from "./types";

interface SessionRepoFields {
  repoOwner: string | null;
  repoName: string | null;
  repoProvider: RepoProviderId;
  repoMeta: unknown;
}

export function getProviderById(id: RepoProviderId): GitProvider {
  if (id === "github") return gitHubProvider;
  return azureDevOpsProvider;
}

export function getProviderForSession(session: SessionRepoFields): GitProvider {
  return getProviderById(session.repoProvider);
}

export function parseRepoMeta(value: unknown): RepoMeta | null {
  if (value == null) return null;
  const result = repoMetaSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function sessionToRepoRef(session: SessionRepoFields): RepoRef | null {
  if (!(session.repoOwner && session.repoName)) {
    return null;
  }

  if (session.repoProvider === "github") {
    return {
      provider: "github",
      owner: session.repoOwner,
      repo: session.repoName,
    };
  }

  const meta = parseRepoMeta(session.repoMeta);
  if (!meta || meta.provider !== "azure_devops") {
    return null;
  }

  return {
    provider: "azure_devops",
    org: session.repoOwner,
    project: meta.project,
    repo: session.repoName,
  };
}
