import "server-only";

export function isAzureDevOpsEnabled(): boolean {
  return process.env.AZURE_DEVOPS_ENABLED === "true";
}

export function isGitHubEnabled(): boolean {
  return process.env.GITHUB_ENABLED !== "false";
}
