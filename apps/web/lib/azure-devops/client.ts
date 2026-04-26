import "server-only";
import * as azdev from "azure-devops-node-api";
import type { ICoreApi } from "azure-devops-node-api/CoreApi";
import type { IGitApi } from "azure-devops-node-api/GitApi";
import {
  type GitPullRequest,
  type GitRepository,
  PullRequestStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import { getAzureDevOpsConfig } from "./config";
import { buildAdoPullRequestUrl, buildAdoRepoWebUrl } from "./repo-identifiers";

export interface AdoApis {
  getCoreApi(): Promise<ICoreApi>;
  getGitApi(): Promise<IGitApi>;
}

export interface AdoProjectSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface AdoRepoSummary {
  id: string;
  name: string;
  project: string;
  defaultBranch: string | null;
  webUrl: string;
}

export interface AdoFindPrResult {
  found: boolean;
  prNumber?: number;
  prStatus?: "open" | "closed" | "merged";
  prUrl?: string;
  prTitle?: string;
}

export interface AdoCreatePrResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  error?: string;
}

export interface AdoPrStatusResult {
  success: boolean;
  status?: "open" | "closed" | "merged";
  error?: string;
}

export interface AdoClient {
  listProjects(): Promise<AdoProjectSummary[]>;
  listRepositories(project: string): Promise<AdoRepoSummary[]>;
  getRepository(args: {
    project: string;
    repo: string;
  }): Promise<AdoRepoSummary | null>;
  findPullRequestByBranch(args: {
    project: string;
    repo: string;
    branchName: string;
  }): Promise<AdoFindPrResult>;
  createPullRequest(args: {
    project: string;
    repo: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    isDraft?: boolean;
  }): Promise<AdoCreatePrResult>;
  getPullRequestStatus(args: {
    project: string;
    repo: string;
    prNumber: number;
  }): Promise<AdoPrStatusResult>;
}

const REFS_HEADS = "refs/heads/";

function stripRefsHeads(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.startsWith(REFS_HEADS) ? value.slice(REFS_HEADS.length) : value;
}

function normalizePrStatus(
  pr: Pick<GitPullRequest, "status" | "mergeStatus">,
): "open" | "closed" | "merged" {
  switch (pr.status) {
    case PullRequestStatus.Completed:
      return "merged";
    case PullRequestStatus.Abandoned:
      return "closed";
    default:
      return "open";
  }
}

function mapRepo(org: string, repo: GitRepository): AdoRepoSummary | null {
  if (!(repo.id && repo.name && repo.project?.name)) {
    return null;
  }
  return {
    id: repo.id,
    name: repo.name,
    project: repo.project.name,
    defaultBranch: stripRefsHeads(repo.defaultBranch ?? null),
    webUrl: buildAdoRepoWebUrl({
      org,
      project: repo.project.name,
      repo: repo.name,
    }),
  };
}

export function buildAdoClient(apis: AdoApis, orgSlug: string): AdoClient {
  const org = orgSlug;

  return {
    async listProjects() {
      const coreApi = await apis.getCoreApi();
      const projects = await coreApi.getProjects();
      return (projects ?? [])
        .filter((p) => p.id && p.name)
        .map((p) => ({
          id: p.id as string,
          name: p.name as string,
          description: p.description ?? null,
        }));
    },

    async listRepositories(project) {
      const gitApi = await apis.getGitApi();
      const repos = await gitApi.getRepositories(project);
      return (repos ?? [])
        .map((r) => mapRepo(org, r))
        .filter((r): r is AdoRepoSummary => r !== null);
    },

    async getRepository({ project, repo }) {
      const gitApi = await apis.getGitApi();
      const result = await gitApi.getRepository(repo, project);
      return result ? mapRepo(org, result) : null;
    },

    async findPullRequestByBranch({ project, repo, branchName }) {
      const gitApi = await apis.getGitApi();
      const prs = await gitApi.getPullRequests(
        repo,
        {
          sourceRefName: `${REFS_HEADS}${branchName}`,
          // azure-devops-node-api uses numeric enums; PullRequestStatus.All === 4.
          status: PullRequestStatus.All,
        },
        project,
      );

      const pr = (prs ?? []).sort(
        (a, b) =>
          (b.creationDate?.getTime() ?? 0) - (a.creationDate?.getTime() ?? 0),
      )[0];

      if (!pr?.pullRequestId) {
        return { found: false };
      }

      return {
        found: true,
        prNumber: pr.pullRequestId,
        prStatus: normalizePrStatus(pr),
        prUrl: buildAdoPullRequestUrl({ org, project, repo }, pr.pullRequestId),
        prTitle: pr.title ?? undefined,
      };
    },

    async createPullRequest({
      project,
      repo,
      sourceBranch,
      targetBranch,
      title,
      description,
      isDraft = false,
    }) {
      const gitApi = await apis.getGitApi();
      try {
        const created = await gitApi.createPullRequest(
          {
            sourceRefName: `${REFS_HEADS}${sourceBranch}`,
            targetRefName: `${REFS_HEADS}${targetBranch}`,
            title,
            description,
            isDraft,
          },
          repo,
          project,
        );

        if (!created?.pullRequestId) {
          return { success: false, error: "PR creation returned no ID" };
        }

        return {
          success: true,
          prNumber: created.pullRequestId,
          prUrl: buildAdoPullRequestUrl(
            { org, project, repo },
            created.pullRequestId,
          ),
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (/already exists|TF401179/i.test(message)) {
          return { success: false, error: "PR already exists" };
        }
        if (/401|unauthor/i.test(message)) {
          return { success: false, error: "ADO PAT unauthorized" };
        }
        return { success: false, error: message };
      }
    },

    async getPullRequestStatus({ project, repo, prNumber }) {
      const gitApi = await apis.getGitApi();
      try {
        const pr = await gitApi.getPullRequestById(prNumber, project);
        if (!pr || pr.repository?.name !== repo) {
          return { success: false, error: "PR not found" };
        }
        return { success: true, status: normalizePrStatus(pr) };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { success: false, error: message };
      }
    },
  };
}

/**
 * Returns a configured ADO client using env-var auth, or null if disabled.
 */
export function getAdoClient(): AdoClient | null {
  const config = getAzureDevOpsConfig();
  if (!config.enabled) {
    return null;
  }
  const handler = azdev.getPersonalAccessTokenHandler(config.pat);
  const connection = new azdev.WebApi(
    `https://dev.azure.com/${encodeURIComponent(config.org)}`,
    handler,
  );
  return buildAdoClient(connection, config.org);
}
