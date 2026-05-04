import "server-only";

export function isAzureDevOpsEnabled(): boolean {
  return process.env.AZURE_DEVOPS_ENABLED === "true";
}

export function isGitHubEnabled(): boolean {
  return process.env.GITHUB_ENABLED !== "false";
}

export function getEnabledRepoProviders(): Array<"github" | "azure_devops"> {
  const providers: Array<"github" | "azure_devops"> = [];
  if (isGitHubEnabled()) providers.push("github");
  if (isAzureDevOpsEnabled()) providers.push("azure_devops");
  return providers;
}

export function gitHubDisabledResponse(): Response {
  return Response.json(
    { error: "provider_disabled", provider: "github" },
    { status: 403 },
  );
}
