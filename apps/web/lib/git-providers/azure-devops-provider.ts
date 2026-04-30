import "server-only";
import { getAdoClient } from "@/lib/azure-devops/client";
import { getAzureDevOpsConfig } from "@/lib/azure-devops/config";
import { fetchAdoRepoFile } from "@/lib/azure-devops/fetch-repo-file";
import {
  buildAdoAuthRemoteUrl,
  buildAdoPullRequestUrl,
  buildAdoRepoWebUrl,
  isValidAdoIdentifier,
} from "@/lib/azure-devops/repo-identifiers";
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

function ensureAdo(
  ref: RepoRef,
): { org: string; project: string; repo: string } | null {
  return ref.provider === "azure_devops"
    ? { org: ref.org, project: ref.project, repo: ref.repo }
    : null;
}

export const azureDevOpsProvider: GitProvider = {
  id: "azure_devops",

  validateRepoIdentifiers(ref) {
    const ado = ensureAdo(ref);
    if (!ado) return false;
    return (
      isValidAdoIdentifier(ado.org) &&
      isValidAdoIdentifier(ado.project) &&
      isValidAdoIdentifier(ado.repo)
    );
  },

  async getCloneToken(_userId) {
    const config = getAzureDevOpsConfig();
    return config.enabled ? config.pat : null;
  },

  buildAuthRemoteUrl({ token, ref }) {
    const ado = ensureAdo(ref);
    if (!ado) return null;
    return buildAdoAuthRemoteUrl({ token, ...ado });
  },

  async getDefaultBranch({ ref }) {
    const ado = ensureAdo(ref);
    if (!ado) return null;
    const client = getAdoClient();
    if (!client) return null;
    const repo = await client.getRepository({
      project: ado.project,
      repo: ado.repo,
    });
    return repo?.defaultBranch ?? null;
  },

  async findPullRequestByBranch({ ref, branchName }): Promise<PrFindResult> {
    const ado = ensureAdo(ref);
    if (!ado) return { found: false, error: "Not an Azure DevOps repo" };
    const client = getAdoClient();
    if (!client) {
      return { found: false, error: "Azure DevOps provider is disabled" };
    }
    return client.findPullRequestByBranch({
      project: ado.project,
      repo: ado.repo,
      branchName,
    });
  },

  async createPullRequest({
    ref,
    branchName,
    baseBranch,
    title,
    body,
    isDraft,
  }): Promise<PrCreateResult> {
    const ado = ensureAdo(ref);
    if (!ado) {
      return { success: false, error: "Not an Azure DevOps repo" };
    }
    const client = getAdoClient();
    if (!client) {
      return { success: false, error: "Azure DevOps provider is disabled" };
    }
    return client.createPullRequest({
      project: ado.project,
      repo: ado.repo,
      sourceBranch: branchName,
      targetBranch: baseBranch,
      title,
      description: body,
      isDraft,
    });
  },

  async getPullRequestStatus({ ref, prNumber }): Promise<PrStatusResult> {
    const ado = ensureAdo(ref);
    if (!ado) {
      return { success: false, error: "Not an Azure DevOps repo" };
    }
    const client = getAdoClient();
    if (!client) {
      return { success: false, error: "Azure DevOps provider is disabled" };
    }
    return client.getPullRequestStatus({
      project: ado.project,
      repo: ado.repo,
      prNumber,
    });
  },

  async closePullRequest({ ref, prNumber }): Promise<ClosePrResult> {
    const ado = ensureAdo(ref);
    if (!ado) return { success: false, error: "Not an Azure DevOps repo" };
    const client = getAdoClient();
    if (!client) {
      return { success: false, error: "Azure DevOps provider is disabled" };
    }
    return client.abandonPullRequest({
      project: ado.project,
      repo: ado.repo,
      prNumber,
    });
  },

  async mergePullRequest({
    ref,
    prNumber,
    mergeMethod,
    expectedHeadSha,
  }): Promise<MergePrResult> {
    const ado = ensureAdo(ref);
    if (!ado) return { success: false, error: "Not an Azure DevOps repo" };
    const client = getAdoClient();
    if (!client) {
      return { success: false, error: "Azure DevOps provider is disabled" };
    }
    return client.completePullRequest({
      project: ado.project,
      repo: ado.repo,
      prNumber,
      mergeMethod,
      expectedHeadSha,
    });
  },

  async getMergeReadiness({
    ref,
    prNumber,
  }): Promise<PullRequestMergeReadiness> {
    const ado = ensureAdo(ref);
    if (!ado) {
      return {
        success: false,
        canMerge: false,
        reasons: ["Not an Azure DevOps repo"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        error: "Not an Azure DevOps repo",
      };
    }
    const client = getAdoClient();
    if (!client) {
      return {
        success: false,
        canMerge: false,
        reasons: ["Azure DevOps provider is disabled"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        error: "Azure DevOps provider is disabled",
      };
    }
    return client.getMergeReadiness({
      project: ado.project,
      repo: ado.repo,
      prNumber,
    });
  },

  async deleteBranch({ ref, branchName }): Promise<DeleteBranchResult> {
    const ado = ensureAdo(ref);
    if (!ado) return { success: false, error: "Not an Azure DevOps repo" };
    const client = getAdoClient();
    if (!client) {
      return { success: false, error: "Azure DevOps provider is disabled" };
    }
    return client.deleteBranch({
      project: ado.project,
      repo: ado.repo,
      branchName,
    });
  },

  buildPullRequestUrl(ref, prNumber) {
    if (ref.provider !== "azure_devops") {
      throw new Error("buildPullRequestUrl called with non-ADO ref");
    }
    return buildAdoPullRequestUrl(ref, prNumber);
  },

  buildRepoWebUrl(ref) {
    if (ref.provider !== "azure_devops") {
      throw new Error("buildRepoWebUrl called with non-ADO ref");
    }
    return buildAdoRepoWebUrl(ref);
  },

  async fetchRepoFile({ ref, branch, path, token }) {
    const ado = ensureAdo(ref);
    if (!ado) {
      throw new Error("fetchRepoFile called with non-ADO ref");
    }
    return fetchAdoRepoFile({
      org: ado.org,
      project: ado.project,
      repo: ado.repo,
      branch,
      path,
      pat: token,
    });
  },
};
