/**
 * Client-safe provider URL builders. These do not import "server-only"
 * because they're consumed by both server and browser components.
 *
 * They take a minimal session shape and dispatch on repo_provider,
 * mirroring what the server-side GitProvider methods produce. Returning
 * null when the session is missing identifiers lets callers gracefully
 * hide UI affordances.
 */

import type { RepoProviderId } from "./types";

interface SessionUrlFields {
  repoOwner: string | null | undefined;
  repoName: string | null | undefined;
  repoProvider?: RepoProviderId | null;
  repoMeta?: unknown;
}

function getProvider(session: SessionUrlFields): RepoProviderId {
  return session.repoProvider ?? "github";
}

function getProject(session: SessionUrlFields): string | null {
  const meta = session.repoMeta;
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const candidate = meta as { provider?: unknown; project?: unknown };
  if (
    candidate.provider === "azure_devops" &&
    typeof candidate.project === "string"
  ) {
    return candidate.project;
  }
  return null;
}

export function buildRepoWebUrl(session: SessionUrlFields): string | null {
  if (!(session.repoOwner && session.repoName)) {
    return null;
  }
  if (getProvider(session) === "azure_devops") {
    const project = getProject(session);
    if (!project) return null;
    return `https://dev.azure.com/${encodeURIComponent(session.repoOwner)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(session.repoName)}`;
  }
  return `https://github.com/${session.repoOwner}/${session.repoName}`;
}

export function buildPullRequestUrl(
  session: SessionUrlFields,
  prNumber: number,
): string | null {
  const repoUrl = buildRepoWebUrl(session);
  if (!repoUrl) return null;
  if (getProvider(session) === "azure_devops") {
    return `${repoUrl}/pullrequest/${prNumber}`;
  }
  return `${repoUrl}/pull/${prNumber}`;
}

export function buildBranchUrl(
  session: SessionUrlFields,
  branch: string,
): string | null {
  const repoUrl = buildRepoWebUrl(session);
  if (!repoUrl) return null;
  if (getProvider(session) === "azure_devops") {
    return `${repoUrl}?version=GB${encodeURIComponent(branch)}`;
  }
  return `${repoUrl}/tree/${branch}`;
}

export function buildCommitUrl(
  session: SessionUrlFields,
  commitSha: string,
): string | null {
  const repoUrl = buildRepoWebUrl(session);
  if (!repoUrl) return null;
  if (getProvider(session) === "azure_devops") {
    return `${repoUrl}/commit/${encodeURIComponent(commitSha)}`;
  }
  return `https://github.com/${session.repoOwner}/${session.repoName}/commit/${encodeURIComponent(commitSha)}`;
}

export function buildCompareUrl(
  session: SessionUrlFields,
  baseBranch: string,
  headRef: string,
): string | null {
  const repoUrl = buildRepoWebUrl(session);
  if (!repoUrl) return null;
  if (getProvider(session) === "azure_devops") {
    return `${repoUrl}/branches?baseVersion=GB${encodeURIComponent(baseBranch)}&targetVersion=GB${encodeURIComponent(headRef)}&_a=files`;
  }
  return `https://github.com/${session.repoOwner}/${session.repoName}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headRef)}`;
}
