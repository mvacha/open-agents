import { z } from "zod";

export const REPO_PROVIDER_IDS = ["github", "azure_devops"] as const;
export type RepoProviderId = (typeof REPO_PROVIDER_IDS)[number];

export const repoMetaSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("github") }),
  z.object({
    provider: z.literal("azure_devops"),
    project: z.string().min(1),
  }),
]);

export type RepoMeta = z.infer<typeof repoMetaSchema>;

export type RepoRef =
  | { provider: "github"; owner: string; repo: string }
  | {
      provider: "azure_devops";
      org: string;
      project: string;
      repo: string;
    };

export interface PrFindResult {
  found: boolean;
  prNumber?: number;
  prStatus?: "open" | "closed" | "merged";
  prUrl?: string;
  prTitle?: string;
  error?: string;
}

export interface PrCreateResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  nodeId?: string;
  error?: string;
}

export interface PrStatusResult {
  success: boolean;
  status?: "open" | "closed" | "merged";
  error?: string;
}

export type PullRequestMergeMethod = "merge" | "squash" | "rebase";

export type PullRequestCheckState = "passed" | "pending" | "failed";

export interface PullRequestCheckRun {
  id: number;
  name: string;
  state: PullRequestCheckState;
  status: string | null;
  conclusion: string | null;
  detailsUrl: string | null;
}

export interface PullRequestCheckSummary {
  requiredTotal: number;
  passed: number;
  pending: number;
  failed: number;
}

export interface PullRequestMergeReadiness {
  success: boolean;
  canMerge: boolean;
  reasons: string[];
  allowedMethods: PullRequestMergeMethod[];
  defaultMethod: PullRequestMergeMethod;
  checks: PullRequestCheckSummary;
  checkRuns?: PullRequestCheckRun[];
  pr?: {
    number: number;
    state: "open" | "closed";
    isDraft: boolean;
    title: string;
    body: string | null;
    baseBranch: string;
    headBranch: string;
    headSha: string;
    headOwner: string | null;
    mergeable: boolean | null;
    mergeableState: string | null;
    additions: number;
    deletions: number;
    changedFiles: number;
    commits: number;
  };
  error?: string;
}

export interface MergePrResult {
  success: boolean;
  sha?: string;
  error?: string;
  statusCode?: number;
}

export interface ClosePrResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export interface DeleteBranchResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export interface GitProvider {
  readonly id: RepoProviderId;
  validateRepoIdentifiers(ref: RepoRef): boolean;
  getCloneToken(userId: string): Promise<string | null>;
  buildAuthRemoteUrl(args: { token: string; ref: RepoRef }): string | null;
  getDefaultBranch(args: {
    ref: RepoRef;
    token: string;
  }): Promise<string | null>;
  findPullRequestByBranch(args: {
    ref: RepoRef;
    branchName: string;
    token: string;
  }): Promise<PrFindResult>;
  createPullRequest(args: {
    ref: RepoRef;
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
    isDraft?: boolean;
    token: string;
  }): Promise<PrCreateResult>;
  getPullRequestStatus(args: {
    ref: RepoRef;
    prNumber: number;
    token: string;
  }): Promise<PrStatusResult>;
  closePullRequest(args: {
    ref: RepoRef;
    prNumber: number;
    token: string;
  }): Promise<ClosePrResult>;
  mergePullRequest(args: {
    ref: RepoRef;
    prNumber: number;
    mergeMethod?: PullRequestMergeMethod;
    expectedHeadSha?: string;
    commitTitle?: string;
    commitMessage?: string;
    token: string;
  }): Promise<MergePrResult>;
  getMergeReadiness(args: {
    ref: RepoRef;
    prNumber: number;
    token: string;
  }): Promise<PullRequestMergeReadiness>;
  deleteBranch(args: {
    ref: RepoRef;
    branchName: string;
    token: string;
  }): Promise<DeleteBranchResult>;
  buildPullRequestUrl(ref: RepoRef, prNumber: number): string;
  buildRepoWebUrl(ref: RepoRef): string;
  /**
   * Fetch a file's contents from the repository at a specific branch.
   * Returns the file contents as a UTF-8 string, or `null` when the file
   * does not exist (404). All other failures throw.
   */
  fetchRepoFile(args: {
    ref: RepoRef;
    branch: string;
    path: string;
    token: string;
  }): Promise<string | null>;
}
