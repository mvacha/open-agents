import "server-only";
import { isAzureDevOpsEnabled } from "@/lib/git-providers/feature-flags";

export type AzureDevOpsConfig =
  | { enabled: false }
  | { enabled: true; org: string; pat: string };

let warnedMissing = false;

export function getAzureDevOpsConfig(): AzureDevOpsConfig {
  if (!isAzureDevOpsEnabled()) {
    return { enabled: false };
  }

  const org = process.env.AZURE_DEVOPS_ORG?.trim();
  const pat = process.env.AZURE_DEVOPS_PAT?.trim();

  if (!org || !pat) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error(
        "[azure-devops] AZURE_DEVOPS_ENABLED=true but AZURE_DEVOPS_ORG or AZURE_DEVOPS_PAT is missing/empty. Provider treated as disabled.",
      );
    }
    return { enabled: false };
  }

  return { enabled: true, org, pat };
}
