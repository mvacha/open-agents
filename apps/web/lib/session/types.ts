export interface Session {
  created: number;
  authProvider: "vercel" | "github";
  user: {
    id: string;
    username: string;
    email: string | undefined;
    avatar: string;
    name?: string;
  };
}

export interface SessionUserInfo {
  user: Session["user"] | undefined;
  authProvider?: "vercel" | "github";
  hasGitHub?: boolean;
  hasGitHubAccount?: boolean;
  hasGitHubInstallations?: boolean;
  vercelReconnectRequired?: boolean;
  /**
   * Deployment-level feature flags for git providers. Reflect the
   * GITHUB_ENABLED / AZURE_DEVOPS_ENABLED env vars at request time.
   */
  gitHubProviderEnabled?: boolean;
  azureDevOpsProviderEnabled?: boolean;
}
