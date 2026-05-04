import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getEnabledRepoProviders } from "../git-providers/feature-flags";
import { db } from "./client";
import { sessions } from "./schema";

export type LastRepoInfo =
  | { provider: "github"; owner: string; repo: string }
  | {
      provider: "azure_devops";
      org: string;
      project: string;
      repo: string;
      webUrl: string | null;
    };

/**
 * Returns the repo info from the user's most recently created session
 * that was started from a repository whose provider is currently
 * enabled, or null if none exists.
 */
export async function getLastRepoByUserId(
  userId: string,
): Promise<LastRepoInfo | null> {
  const enabledProviders = getEnabledRepoProviders();
  if (enabledProviders.length === 0) return null;

  const row = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.userId, userId),
      isNotNull(sessions.repoOwner),
      isNotNull(sessions.repoName),
      inArray(sessions.repoProvider, enabledProviders),
    ),
    orderBy: [desc(sessions.createdAt)],
    columns: {
      repoOwner: true,
      repoName: true,
      repoProvider: true,
      repoMeta: true,
      cloneUrl: true,
    },
  });

  if (!row?.repoOwner || !row?.repoName) return null;

  if (row.repoProvider === "azure_devops") {
    const project =
      row.repoMeta && row.repoMeta.provider === "azure_devops"
        ? row.repoMeta.project
        : null;
    if (!project) return null;
    return {
      provider: "azure_devops",
      org: row.repoOwner,
      project,
      repo: row.repoName,
      webUrl: row.cloneUrl ?? null,
    };
  }

  return {
    provider: "github",
    owner: row.repoOwner,
    repo: row.repoName,
  };
}
