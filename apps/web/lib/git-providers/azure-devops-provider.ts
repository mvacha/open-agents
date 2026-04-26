import "server-only";
import { getAdoClient } from "@/lib/azure-devops/client";
import { getAzureDevOpsConfig } from "@/lib/azure-devops/config";
import {
  buildAdoAuthRemoteUrl,
  buildAdoPullRequestUrl,
  buildAdoRepoWebUrl,
  isValidAdoIdentifier,
} from "@/lib/azure-devops/repo-identifiers";
import type {
  GitProvider,
  PrCreateResult,
  PrFindResult,
  PrStatusResult,
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
};
