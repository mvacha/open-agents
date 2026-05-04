"use client";

import useSWR from "swr";
import type { SessionUserInfo } from "@/lib/session/types";
import { fetcher } from "@/lib/swr";

export function useSession() {
  const { data, isLoading } = useSWR<SessionUserInfo>(
    "/api/auth/info",
    fetcher,
    {
      revalidateOnFocus: true,
    },
  );

  return {
    session: data ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    hasGitHub: data?.hasGitHub ?? false,
    hasGitHubAccount: data?.hasGitHubAccount ?? false,
    hasGitHubInstallations: data?.hasGitHubInstallations ?? false,
    // Default to true so we don't hide GitHub UI before the session loads;
    // the API route always sends an explicit boolean.
    gitHubProviderEnabled: data?.gitHubProviderEnabled ?? true,
    azureDevOpsProviderEnabled: data?.azureDevOpsProviderEnabled ?? false,
  };
}
