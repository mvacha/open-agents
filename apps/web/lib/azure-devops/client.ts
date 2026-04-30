import "server-only";
import * as azdev from "azure-devops-node-api";
import type { ICoreApi } from "azure-devops-node-api/CoreApi";
import type { IGitApi } from "azure-devops-node-api/GitApi";
import {
  type GitPullRequest,
  GitPullRequestMergeStrategy,
  type GitRepository,
  GitStatusState,
  PullRequestAsyncStatus,
  PullRequestStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import type {
  PullRequestCheckRun,
  PullRequestCheckState,
  PullRequestMergeMethod,
  PullRequestMergeReadiness,
} from "@/lib/git-providers/types";
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

export interface AdoMergeResult {
  success: boolean;
  sha?: string;
  error?: string;
  statusCode?: number;
}

export interface AdoCloseResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export interface AdoDeleteBranchResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export interface AdoBranchListResult {
  branches: string[];
  defaultBranch: string;
}

export interface AdoClient {
  listProjects(): Promise<AdoProjectSummary[]>;
  listRepositories(project: string): Promise<AdoRepoSummary[]>;
  getRepository(args: {
    project: string;
    repo: string;
  }): Promise<AdoRepoSummary | null>;
  listBranches(args: {
    project: string;
    repo: string;
    query?: string;
    limit?: number;
  }): Promise<AdoBranchListResult>;
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
  abandonPullRequest(args: {
    project: string;
    repo: string;
    prNumber: number;
  }): Promise<AdoCloseResult>;
  completePullRequest(args: {
    project: string;
    repo: string;
    prNumber: number;
    mergeMethod?: PullRequestMergeMethod;
    expectedHeadSha?: string;
  }): Promise<AdoMergeResult>;
  getMergeReadiness(args: {
    project: string;
    repo: string;
    prNumber: number;
  }): Promise<PullRequestMergeReadiness>;
  deleteBranch(args: {
    project: string;
    repo: string;
    branchName: string;
  }): Promise<AdoDeleteBranchResult>;
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

    async listBranches({ project, repo, query, limit = 50 }) {
      const gitApi = await apis.getGitApi();
      const repository = await gitApi.getRepository(repo, project);
      const defaultBranch =
        stripRefsHeads(repository?.defaultBranch ?? null) ?? "main";

      const refs = await gitApi.getRefs(
        repository?.id ?? repo,
        project,
        "heads/",
      );
      const all = (refs ?? [])
        .map((r) => stripRefsHeads(r.name ?? null))
        .filter((name): name is string => typeof name === "string");
      const filtered = query
        ? all.filter((name) => name.toLowerCase().includes(query.toLowerCase()))
        : all;
      // Surface the default branch first when it exists in the result.
      const sorted = filtered
        .slice()
        .sort((a, b) => {
          if (a === defaultBranch) return -1;
          if (b === defaultBranch) return 1;
          return a.localeCompare(b);
        })
        .slice(0, Math.max(1, Math.min(limit, 200)));
      return { branches: sorted, defaultBranch };
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

    async abandonPullRequest({ project, repo, prNumber }) {
      const gitApi = await apis.getGitApi();
      try {
        const repository = await gitApi.getRepository(repo, project);
        if (!repository?.id) {
          return {
            success: false,
            error: "Repository not found",
            statusCode: 404,
          };
        }
        await gitApi.updatePullRequest(
          { status: PullRequestStatus.Abandoned },
          repository.id,
          prNumber,
          project,
        );
        return { success: true };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (/404/.test(message)) {
          return { success: false, error: "PR not found", statusCode: 404 };
        }
        if (/401|unauthor/i.test(message)) {
          return {
            success: false,
            error: "ADO PAT unauthorized",
            statusCode: 401,
          };
        }
        if (/403|forbid/i.test(message)) {
          return {
            success: false,
            error: "Permission denied",
            statusCode: 403,
          };
        }
        return { success: false, error: message, statusCode: 502 };
      }
    },

    async completePullRequest({
      project,
      repo,
      prNumber,
      mergeMethod = "squash",
      expectedHeadSha,
    }) {
      const gitApi = await apis.getGitApi();
      try {
        const repository = await gitApi.getRepository(repo, project);
        if (!repository?.id) {
          return {
            success: false,
            error: "Repository not found",
            statusCode: 404,
          };
        }
        const current = await gitApi.getPullRequestById(prNumber, project);
        if (!current?.lastMergeSourceCommit?.commitId) {
          return {
            success: false,
            error: "PR has no source commit to merge",
            statusCode: 409,
          };
        }
        if (
          expectedHeadSha &&
          expectedHeadSha.toLowerCase() !==
            current.lastMergeSourceCommit.commitId.toLowerCase()
        ) {
          return {
            success: false,
            error:
              "Pull request has new commits. Refresh and review before merging.",
            statusCode: 409,
          };
        }

        const mergeStrategy: GitPullRequestMergeStrategy =
          mergeMethod === "squash"
            ? GitPullRequestMergeStrategy.Squash
            : mergeMethod === "rebase"
              ? GitPullRequestMergeStrategy.Rebase
              : GitPullRequestMergeStrategy.NoFastForward;

        const updated = await gitApi.updatePullRequest(
          {
            status: PullRequestStatus.Completed,
            lastMergeSourceCommit: current.lastMergeSourceCommit,
            completionOptions: {
              mergeStrategy,
              deleteSourceBranch: false,
            },
          },
          repository.id,
          prNumber,
          project,
        );

        return {
          success: true,
          sha: updated?.lastMergeCommit?.commitId,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (/conflict/i.test(message)) {
          return {
            success: false,
            error: "Pull request has conflicts or is out of date",
            statusCode: 409,
          };
        }
        if (/policy/i.test(message)) {
          return {
            success: false,
            error: "Branch policies are not satisfied",
            statusCode: 405,
          };
        }
        if (/401|unauthor/i.test(message)) {
          return {
            success: false,
            error: "ADO PAT unauthorized",
            statusCode: 401,
          };
        }
        if (/403|forbid/i.test(message)) {
          return {
            success: false,
            error: "Permission denied",
            statusCode: 403,
          };
        }
        return { success: false, error: message, statusCode: 502 };
      }
    },

    async getMergeReadiness({ project, repo, prNumber }) {
      const gitApi = await apis.getGitApi();
      const failure = (error: string): PullRequestMergeReadiness => ({
        success: false,
        canMerge: false,
        reasons: [error],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        error,
      });

      try {
        const pr = await gitApi.getPullRequestById(prNumber, project);
        if (!pr || pr.repository?.name !== repo) {
          return failure("Pull request not found");
        }

        const statuses = await gitApi
          .getPullRequestStatuses(pr.repository?.id ?? repo, prNumber, project)
          .catch(() => []);

        const mapStatusState = (
          state: GitStatusState | undefined,
        ): PullRequestCheckState => {
          if (state === GitStatusState.Succeeded) return "passed";
          if (
            state === GitStatusState.Failed ||
            state === GitStatusState.Error
          ) {
            return "failed";
          }
          return "pending";
        };

        const checkRuns: PullRequestCheckRun[] = (statuses ?? []).map(
          (s, i) => ({
            id: s.id ?? i,
            name:
              [s.context?.genre, s.context?.name].filter(Boolean).join("/") ||
              "status",
            state: mapStatusState(s.state),
            status: s.state != null ? (GitStatusState[s.state] ?? null) : null,
            conclusion: s.description ?? null,
            detailsUrl: s.targetUrl ?? null,
          }),
        );

        const summary = checkRuns.reduce(
          (acc, run) => {
            acc.requiredTotal += 1;
            if (run.state === "passed") acc.passed += 1;
            else if (run.state === "failed") acc.failed += 1;
            else acc.pending += 1;
            return acc;
          },
          { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        );

        const isOpen = pr.status === PullRequestStatus.Active;
        const isDraft = pr.isDraft === true;
        const mergeable: boolean | null =
          pr.mergeStatus === PullRequestAsyncStatus.Succeeded
            ? true
            : pr.mergeStatus === PullRequestAsyncStatus.Conflicts ||
                pr.mergeStatus === PullRequestAsyncStatus.Failure ||
                pr.mergeStatus === PullRequestAsyncStatus.RejectedByPolicy
              ? false
              : null;

        const reasons: string[] = [];
        if (!isOpen) reasons.push("Pull request is not open");
        if (isDraft) reasons.push("Pull request is a draft");
        if (mergeable === false) {
          if (pr.mergeStatus === PullRequestAsyncStatus.Conflicts) {
            reasons.push("Pull request has merge conflicts");
          } else if (
            pr.mergeStatus === PullRequestAsyncStatus.RejectedByPolicy
          ) {
            reasons.push("Branch policies are not satisfied");
          } else {
            reasons.push("Pull request cannot be merged");
          }
        }
        if (summary.failed > 0) reasons.push("Required checks are failing");
        else if (summary.pending > 0)
          reasons.push("Required checks are still pending");

        const canMerge =
          isOpen &&
          !isDraft &&
          mergeable !== false &&
          summary.failed === 0 &&
          summary.pending === 0;

        return {
          success: true,
          canMerge,
          reasons,
          allowedMethods: ["squash", "merge", "rebase"],
          defaultMethod: "squash",
          checks: summary,
          checkRuns,
          pr: {
            number: prNumber,
            state: isOpen ? "open" : "closed",
            isDraft,
            title: pr.title ?? "",
            body: pr.description ?? null,
            baseBranch: stripRefsHeads(pr.targetRefName ?? null) ?? "",
            headBranch: stripRefsHeads(pr.sourceRefName ?? null) ?? "",
            headSha: pr.lastMergeSourceCommit?.commitId ?? "",
            // ADO same-repo PRs only — fork model differs.
            headOwner: org,
            mergeable,
            mergeableState:
              pr.mergeStatus != null
                ? (PullRequestAsyncStatus[pr.mergeStatus] ?? null)
                : null,
            // ADO doesn't expose these counts on the PR object.
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            commits: 0,
          },
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return failure(message);
      }
    },

    async deleteBranch({ project, repo, branchName }) {
      const gitApi = await apis.getGitApi();
      try {
        const repository = await gitApi.getRepository(repo, project);
        if (!repository?.id) {
          return {
            success: false,
            error: "Repository not found",
            statusCode: 404,
          };
        }
        // Look up the current ref so we know its objectId for the delete update.
        const refs = await gitApi.getRefs(
          repository.id,
          project,
          `heads/${branchName}`,
        );
        const ref = refs?.find((r) => r.name === `${REFS_HEADS}${branchName}`);
        if (!ref?.objectId) {
          return { success: true };
        }
        const result = await gitApi.updateRefs(
          [
            {
              name: `${REFS_HEADS}${branchName}`,
              oldObjectId: ref.objectId,
              newObjectId: "0000000000000000000000000000000000000000",
            },
          ],
          repository.id,
          project,
        );
        const success = result?.[0]?.success === true;
        return success
          ? { success: true }
          : {
              success: false,
              error: "Failed to delete branch",
              statusCode: 502,
            };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { success: false, error: message, statusCode: 502 };
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
