import "server-only";
import { fetchGitHubBranches, fetchGitHubRepoFile } from "@/lib/github/api";
import {
  closePullRequest,
  createPullRequest,
  deleteBranchRef,
  findPullRequestByBranch,
  getPullRequestMergeReadiness,
  getPullRequestStatus,
  mergePullRequest,
} from "@/lib/github/client";
import {
  buildGitHubAuthRemoteUrl,
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
} from "@/lib/github/repo-identifiers";
import { getUserGitHubToken } from "@/lib/github/user-token";
import type {
  ClosePrResult,
  DeleteBranchResult,
  GitProvider,
  MergePrResult,
  PrCreateResult,
  PrFindResult,
  PrStatusResult,
  PullRequestMergeReadiness,
  RepoRef,
} from "./types";

function ensureGitHub(ref: RepoRef): { owner: string; repo: string } | null {
  return ref.provider === "github"
    ? { owner: ref.owner, repo: ref.repo }
    : null;
}

export const gitHubProvider: GitProvider = {
  id: "github",

  validateRepoIdentifiers(ref) {
    const gh = ensureGitHub(ref);
    if (!gh) return false;
    return isValidGitHubRepoOwner(gh.owner) && isValidGitHubRepoName(gh.repo);
  },

  async getCloneToken(userId) {
    return getUserGitHubToken(userId);
  },

  buildAuthRemoteUrl({ token, ref }) {
    const gh = ensureGitHub(ref);
    if (!gh) return null;
    return buildGitHubAuthRemoteUrl({ token, owner: gh.owner, repo: gh.repo });
  },

  async getDefaultBranch({ ref, token }) {
    const gh = ensureGitHub(ref);
    if (!gh) return null;
    const data = await fetchGitHubBranches(token, gh.owner, gh.repo);
    return data?.defaultBranch?.trim() ?? null;
  },

  async findPullRequestByBranch({
    ref,
    branchName,
    token,
  }): Promise<PrFindResult> {
    const gh = ensureGitHub(ref);
    if (!gh) return { found: false, error: "Not a GitHub repo" };
    return findPullRequestByBranch({
      owner: gh.owner,
      repo: gh.repo,
      branchName,
      token,
    });
  },

  async createPullRequest({
    ref,
    branchName,
    baseBranch,
    title,
    body,
    isDraft,
    token,
  }): Promise<PrCreateResult> {
    const gh = ensureGitHub(ref);
    if (!gh) {
      return { success: false, error: "Not a GitHub repo" };
    }
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    const result = await createPullRequest({
      repoUrl,
      branchName,
      title,
      body,
      baseBranch,
      isDraft,
      token,
    });
    return {
      success: result.success,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
      nodeId: result.nodeId,
      error: result.error,
    };
  },

  async getPullRequestStatus({
    ref,
    prNumber,
    token,
  }): Promise<PrStatusResult> {
    const gh = ensureGitHub(ref);
    if (!gh) return { success: false, error: "Not a GitHub repo" };
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    return getPullRequestStatus({ repoUrl, prNumber, token });
  },

  async closePullRequest({ ref, prNumber, token }): Promise<ClosePrResult> {
    const gh = ensureGitHub(ref);
    if (!gh) return { success: false, error: "Not a GitHub repo" };
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    return closePullRequest({ repoUrl, prNumber, token });
  },

  async mergePullRequest({
    ref,
    prNumber,
    mergeMethod,
    expectedHeadSha,
    commitTitle,
    commitMessage,
    token,
  }): Promise<MergePrResult> {
    const gh = ensureGitHub(ref);
    if (!gh) return { success: false, error: "Not a GitHub repo" };
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    return mergePullRequest({
      repoUrl,
      prNumber,
      mergeMethod,
      expectedHeadSha,
      commitTitle,
      commitMessage,
      token,
    });
  },

  async getMergeReadiness({
    ref,
    prNumber,
    token,
  }): Promise<PullRequestMergeReadiness> {
    const gh = ensureGitHub(ref);
    if (!gh) {
      return {
        success: false,
        canMerge: false,
        reasons: ["Not a GitHub repo"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        error: "Not a GitHub repo",
      };
    }
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    return getPullRequestMergeReadiness({ repoUrl, prNumber, token });
  },

  async deleteBranch({ ref, branchName, token }): Promise<DeleteBranchResult> {
    const gh = ensureGitHub(ref);
    if (!gh) return { success: false, error: "Not a GitHub repo" };
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    return deleteBranchRef({ repoUrl, branchName, token });
  },

  buildPullRequestUrl(ref, prNumber) {
    if (ref.provider !== "github") {
      throw new Error("buildPullRequestUrl called with non-github ref");
    }
    return `https://github.com/${ref.owner}/${ref.repo}/pull/${prNumber}`;
  },

  buildRepoWebUrl(ref) {
    if (ref.provider !== "github") {
      throw new Error("buildRepoWebUrl called with non-github ref");
    }
    return `https://github.com/${ref.owner}/${ref.repo}`;
  },

  async fetchRepoFile({ ref, branch, path, token }) {
    const gh = ensureGitHub(ref);
    if (!gh) {
      throw new Error("fetchRepoFile called with non-github ref");
    }
    return fetchGitHubRepoFile({
      owner: gh.owner,
      repo: gh.repo,
      branch,
      path,
      token,
    });
  },
};
