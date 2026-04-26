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
  buildPullRequestUrl(ref: RepoRef, prNumber: number): string;
  buildRepoWebUrl(ref: RepoRef): string;
}
