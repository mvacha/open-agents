import "server-only";

export function isAzureDevOpsEnabled(): boolean {
  return process.env.AZURE_DEVOPS_ENABLED === "true";
}

export function isGitHubEnabled(): boolean {
  return process.env.GITHUB_ENABLED !== "false";
}

export function gitHubDisabledResponse(): Response {
  return Response.json(
    { error: "provider_disabled", provider: "github" },
    { status: 403 },
  );
}
