"use client";

import {
  CheckIcon,
  ChevronDown,
  ExternalLink,
  Loader2,
  LockIcon,
  RefreshCw,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { z } from "zod";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type InstallationRepo,
  useInstallationRepos,
} from "@/hooks/use-installation-repos";
import { useGitHubConnectionStatus } from "@/hooks/use-github-connection-status";
import { useSession } from "@/hooks/use-session";
import { buildGitHubReconnectUrl } from "@/lib/github/connection-status";
import { fetcher } from "@/lib/swr";
import { cn } from "@/lib/utils";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function AzureDevOpsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z" />
    </svg>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? "1mo ago" : `${months}mo ago`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

interface Installation {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  installationUrl: string | null;
}

const installationSchema = z.object({
  installationId: z.number(),
  accountLogin: z.string(),
  accountType: z.enum(["User", "Organization"]),
  repositorySelection: z.enum(["all", "selected"]),
  installationUrl: z.string().nullable(),
});

const installationsSchema = z.array(installationSchema);

const adoConnectionStatusSchema = z.union([
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    healthy: z.literal(true),
    org: z.string(),
  }),
  z.object({
    enabled: z.literal(true),
    healthy: z.literal(false),
    reason: z.enum([
      "missing_org_or_pat",
      "pat_invalid",
      "pat_insufficient_scope",
      "network_error",
    ]),
    org: z.string().nullable(),
  }),
]);

const adoProjectsResponseSchema = z.object({
  org: z.string().nullable(),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});

const adoRepoSchema = z.object({
  id: z.string(),
  name: z.string(),
  project: z.string(),
  defaultBranch: z.string().nullable(),
  webUrl: z.string(),
});

const adoReposResponseSchema = z.object({
  repos: z.array(adoRepoSchema),
});

type AdoRepo = z.infer<typeof adoRepoSchema>;

export type RepoSelection =
  | { provider: "github"; owner: string; repo: string }
  | {
      provider: "azure_devops";
      org: string;
      project: string;
      repo: string;
      defaultBranch: string | null;
      webUrl: string;
    };

type Scope =
  | {
      kind: "github";
      key: string;
      label: string;
      installation: Installation;
    }
  | {
      kind: "azure_devops";
      key: string;
      label: string;
      org: string;
      projectId: string;
      projectName: string;
    };

interface RepoSelectorCompactProps {
  selection: RepoSelection | null;
  onSelect: (selection: RepoSelection | null) => void;
}

function getCurrentPathWithSearch(): string {
  return `${window.location.pathname}${window.location.search}`;
}

async function fetchInstallations(): Promise<Installation[]> {
  const response = await fetch("/api/github/installations");
  if (!response.ok) return [];
  const json = await response.json();
  const parsed = installationsSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

async function fetchAdoStatus(url: string) {
  const json = await fetcher<unknown>(url);
  const parsed = adoConnectionStatusSchema.safeParse(json);
  if (!parsed.success) throw new Error("Invalid ADO status response");
  return parsed.data;
}

async function fetchAdoProjects(url: string) {
  const json = await fetcher<unknown>(url);
  const parsed = adoProjectsResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("Invalid ADO projects response");
  return parsed.data;
}

async function fetchAdoRepos(url: string) {
  const json = await fetcher<unknown>(url);
  const parsed = adoReposResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("Invalid ADO repos response");
  return parsed.data.repos;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="h-5 w-[120px] animate-pulse rounded bg-muted-foreground/10" />
        <div className="h-4 w-[48px] animate-pulse rounded bg-muted-foreground/10" />
      </div>
      <div className="h-[26px] w-[52px] shrink-0 animate-pulse rounded-md bg-muted-foreground/10" />
    </div>
  );
}

function GitHubActionCard({
  title,
  description,
  buttonLabel,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 px-4 py-6 text-center dark:border-white/10">
      <GitHubIcon className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="rounded-md bg-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-300"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

export function RepoSelectorCompact({
  selection,
  onSelect,
}: RepoSelectorCompactProps) {
  const { hasGitHub, loading: sessionLoading } = useSession();
  const { reconnectRequired } = useGitHubConnectionStatus({
    enabled: hasGitHub,
  });
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [currentScopeKey, setCurrentScopeKey] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startGitHubInstall = useCallback(() => {
    const params = new URLSearchParams({ next: getCurrentPathWithSearch() });
    window.location.href = `/api/github/app/install?${params.toString()}`;
  }, []);

  const startGitHubReconnect = useCallback(() => {
    window.location.href = buildGitHubReconnectUrl(getCurrentPathWithSearch());
  }, []);

  const { data: installations = [], isLoading: installationsLoading } = useSWR<
    Installation[]
  >(
    hasGitHub && !reconnectRequired ? "github-installations" : null,
    fetchInstallations,
  );

  const { data: adoStatus } = useSWR(
    "/api/azure-devops/connection-status",
    fetchAdoStatus,
  );
  const adoEnabled = adoStatus?.enabled === true;
  const adoOrg = adoEnabled ? adoStatus.org : null;

  const { data: adoProjectsData } = useSWR(
    adoEnabled ? "/api/azure-devops/projects" : null,
    fetchAdoProjects,
  );
  const adoProjects = adoProjectsData?.projects ?? [];
  const resolvedAdoOrg = adoOrg ?? adoProjectsData?.org ?? null;

  const scopes = useMemo<Scope[]>(() => {
    const items: Scope[] = installations.map((installation) => ({
      kind: "github",
      key: `gh:${installation.accountLogin}`,
      label: installation.accountLogin,
      installation,
    }));
    if (resolvedAdoOrg) {
      for (const project of adoProjects) {
        items.push({
          kind: "azure_devops",
          key: `ado:${project.id}`,
          label: project.name,
          org: resolvedAdoOrg,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }
    return items;
  }, [installations, adoProjects, resolvedAdoOrg]);

  const currentScope = useMemo(
    () =>
      scopes.find((scope) => scope.key === currentScopeKey) ??
      scopes[0] ??
      null,
    [scopes, currentScopeKey],
  );

  // Auto-pick the first available scope when none is selected.
  useEffect(() => {
    if (currentScopeKey) return;
    if (scopes[0]) setCurrentScopeKey(scopes[0].key);
  }, [scopes, currentScopeKey]);

  // Sync internal scope with external selection (when parent changes it).
  const lastSelectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let key: string | null = null;
    if (selection?.provider === "github") {
      key = `gh:${selection.owner}`;
    } else if (selection?.provider === "azure_devops") {
      const proj = adoProjects.find((p) => p.name === selection.project);
      if (proj) key = `ado:${proj.id}`;
    }
    if (key && key !== lastSelectionKeyRef.current) {
      lastSelectionKeyRef.current = key;
      setCurrentScopeKey(key);
    }
  }, [selection, adoProjects]);

  // GitHub repos
  const githubInstallationId =
    currentScope?.kind === "github"
      ? currentScope.installation.installationId
      : null;
  const {
    repos: githubRepos,
    isLoading: githubReposLoading,
    error: githubReposError,
    refresh: refreshGithubRepos,
  } = useInstallationRepos({
    installationId: githubInstallationId,
    query: debouncedRepoSearch,
    limit: 25,
  });

  // ADO repos
  const adoReposUrl =
    currentScope?.kind === "azure_devops"
      ? `/api/azure-devops/projects/${encodeURIComponent(
          currentScope.projectId,
        )}/repos${
          debouncedRepoSearch
            ? `?q=${encodeURIComponent(debouncedRepoSearch)}`
            : ""
        }`
      : null;
  const {
    data: adoReposData,
    isLoading: adoReposLoading,
    error: adoReposError,
    mutate: mutateAdoRepos,
  } = useSWR<AdoRepo[]>(adoReposUrl, fetchAdoRepos);
  const adoRepos = adoReposData ?? [];

  const sortedGithubRepos = useMemo(() => {
    const hasAnyDates = githubRepos.some((r) => r.updated_at);
    if (hasAnyDates) {
      return [...githubRepos].sort((a, b) => {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
      });
    }
    return [...githubRepos].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }, [githubRepos]);

  const sortedAdoRepos = useMemo(
    () =>
      [...adoRepos].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
    [adoRepos],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (currentScope?.kind === "github") {
        await refreshGithubRepos();
      } else if (currentScope?.kind === "azure_devops") {
        await mutateAdoRepos();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [currentScope, refreshGithubRepos, mutateAdoRepos]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedRepoSearch(repoSearch.trim());
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [repoSearch]);

  useEffect(() => {
    setRepoSearch("");
  }, [currentScopeKey]);

  const handleScopeSelect = (scope: Scope) => {
    setCurrentScopeKey(scope.key);
    setOwnerOpen(false);
    // Clear repo selection when switching scope
    if (selection) onSelect(null);
  };

  const handleGithubRepoSelect = (repo: InstallationRepo) => {
    if (currentScope?.kind !== "github") return;
    onSelect({
      provider: "github",
      owner: currentScope.installation.accountLogin,
      repo: repo.name,
    });
  };

  const handleAdoRepoSelect = (repo: AdoRepo) => {
    if (currentScope?.kind !== "azure_devops") return;
    onSelect({
      provider: "azure_devops",
      org: currentScope.org,
      project: repo.project,
      repo: repo.name,
      defaultBranch: repo.defaultBranch,
      webUrl: repo.webUrl,
    });
  };

  const handleDeselect = () => onSelect(null);

  const isInitialLoading =
    (installationsLoading && installations.length === 0) ||
    (adoEnabled && !adoProjectsData);
  const hasSelection = !!selection;

  // Empty/error states only matter when no provider has anything to pick.
  const noScopesAvailable =
    !installationsLoading && !installations.length && !adoEnabled;

  if (!sessionLoading && !hasGitHub && !adoEnabled) {
    return (
      <GitHubActionCard
        title="Install GitHub App"
        description="Continue on GitHub to choose which repositories are available."
        buttonLabel="Choose repositories"
        onClick={startGitHubInstall}
      />
    );
  }

  if (reconnectRequired && !adoEnabled) {
    return (
      <GitHubActionCard
        title="Reconnect GitHub"
        description="Your saved GitHub connection is no longer valid. Reconnect to refresh repository access."
        buttonLabel="Reconnect GitHub"
        onClick={startGitHubReconnect}
      />
    );
  }

  if (noScopesAvailable) {
    return (
      <GitHubActionCard
        title="Install GitHub App"
        description="Install the GitHub App to choose which repositories are available."
        buttonLabel="Choose repositories"
        onClick={startGitHubInstall}
      />
    );
  }

  // Collapsed state: a repo is selected
  if (hasSelection && selection) {
    const isGithubSelection = selection.provider === "github";
    const githubMatch = isGithubSelection
      ? githubRepos.find((r) => r.name === selection.repo)
      : null;

    return (
      <div className="flex flex-col gap-0">
        <div className="flex items-center gap-0 overflow-hidden rounded-lg border border-border/70 dark:border-white/10">
          <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 border-r border-border/70 bg-background/80 px-3 py-2.5 text-sm transition-colors hover:bg-accent dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                {isGithubSelection ? (
                  <GitHubIcon className="size-4 shrink-0" />
                ) : (
                  <AzureDevOpsIcon className="size-4 shrink-0 text-[#0078D4]" />
                )}
                <span className="max-w-[140px] truncate font-medium">
                  {isGithubSelection ? selection.owner : selection.project}
                </span>
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <ScopeMenu
              scopes={scopes}
              currentScopeKey={currentScope?.key ?? null}
              onScopeSelect={handleScopeSelect}
              onAddGitHubOrg={() => {
                startGitHubInstall();
                setOwnerOpen(false);
              }}
              hasGitHub={hasGitHub}
              isLoading={isInitialLoading}
            />
          </Popover>

          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5">
            <span className="truncate text-sm font-medium">
              {selection.repo}
            </span>
            {githubMatch?.private && (
              <LockIcon className="size-3 shrink-0 text-muted-foreground" />
            )}
            {githubMatch?.updated_at && (
              <span className="shrink-0 text-xs text-muted-foreground">
                · {formatRelativeDate(githubMatch.updated_at)}
              </span>
            )}
            {!isGithubSelection && selection.defaultBranch && (
              <span className="shrink-0 text-xs text-muted-foreground">
                · {selection.defaultBranch}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleDeselect}
            className="shrink-0 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  // Expanded state
  const scopeIcon =
    currentScope?.kind === "azure_devops" ? (
      <AzureDevOpsIcon className="size-4 shrink-0 text-[#0078D4]" />
    ) : (
      <GitHubIcon className="size-4 shrink-0" />
    );

  const repoListContent =
    currentScope?.kind === "azure_devops" ? (
      adoReposLoading ? (
        <div className="flex h-full flex-col divide-y divide-border/50 dark:divide-white/[0.06]">
          {Array.from({ length: 6 }).map((_, idx) => (
            <SkeletonRow key={idx} />
          ))}
          <div className="flex-1" />
        </div>
      ) : adoReposError ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
          Failed to load repositories.
        </div>
      ) : sortedAdoRepos.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
          No repositories found.
        </div>
      ) : (
        <div className="divide-y divide-border/50 dark:divide-white/[0.06]">
          {sortedAdoRepos.slice(0, 25).map((repo) => (
            <div
              key={repo.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 dark:hover:bg-white/[0.03]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {repo.name}
                </span>
                {repo.defaultBranch && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    · {repo.defaultBranch}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleAdoRepoSelect(repo)}
                className="shrink-0 rounded-md border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent dark:border-white/20 dark:bg-white/[0.06] dark:hover:bg-white/10"
              >
                Select
              </button>
            </div>
          ))}
        </div>
      )
    ) : currentScope?.kind === "github" ? (
      githubReposLoading ? (
        <div className="flex h-full flex-col divide-y divide-border/50 dark:divide-white/[0.06]">
          {Array.from({ length: 6 }).map((_, idx) => (
            <SkeletonRow key={idx} />
          ))}
          <div className="flex-1" />
        </div>
      ) : githubReposError ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
          {githubReposError}
        </div>
      ) : sortedGithubRepos.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
          No repositories found.
        </div>
      ) : (
        <div className="divide-y divide-border/50 dark:divide-white/[0.06]">
          {sortedGithubRepos.slice(0, 25).map((repo) => (
            <div
              key={repo.full_name}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 dark:hover:bg-white/[0.03]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {repo.name}
                </span>
                {repo.private && (
                  <LockIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                {repo.updated_at && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    · {formatRelativeDate(repo.updated_at)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleGithubRepoSelect(repo)}
                className="shrink-0 rounded-md border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent dark:border-white/20 dark:bg-white/[0.06] dark:hover:bg-white/10"
              >
                Select
              </button>
            </div>
          ))}
          {sortedGithubRepos.length === 25 && !debouncedRepoSearch && (
            <div className="px-4 py-2.5 text-center text-xs text-muted-foreground">
              Showing first 25 results. Use search to narrow.
            </div>
          )}
        </div>
      )
    ) : (
      <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
        Select a source to see repositories.
      </div>
    );

  const githubManageUrl =
    currentScope?.kind === "github"
      ? currentScope.installation.installationUrl
      : null;

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-stretch gap-0 overflow-hidden rounded-t-lg border border-border/70 dark:border-white/10">
        <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex shrink-0 items-center gap-2 border-r border-border/70 bg-background/80 px-3 py-2 text-sm transition-colors hover:bg-accent dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
            >
              {scopeIcon}
              {isInitialLoading ? (
                <div className="h-4 w-[80px] animate-pulse rounded bg-muted-foreground/10" />
              ) : (
                <span className="max-w-[140px] truncate font-medium">
                  {currentScope?.label ?? "Select source"}
                </span>
              )}
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <ScopeMenu
            scopes={scopes}
            currentScopeKey={currentScope?.key ?? null}
            onScopeSelect={handleScopeSelect}
            onAddGitHubOrg={() => {
              startGitHubInstall();
              setOwnerOpen(false);
            }}
            hasGitHub={hasGitHub}
            isLoading={isInitialLoading}
          />
        </Popover>

        <div className="flex flex-1 items-center gap-2 bg-background/80 px-3 dark:bg-white/[0.03]">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search repositories..."
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            className="h-full w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {repoSearch && (
            <button
              type="button"
              onClick={() => setRepoSearch("")}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Esc
            </button>
          )}
        </div>
      </div>

      <div className="h-[280px] overflow-y-auto rounded-b-lg border border-t-0 border-border/70 dark:border-white/10">
        {repoListContent}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-3">
          {githubManageUrl && (
            <Link
              href={githubManageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              Manage access
              <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", isRefreshing && "animate-spin")} />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function ScopeMenu({
  scopes,
  currentScopeKey,
  onScopeSelect,
  onAddGitHubOrg,
  hasGitHub,
  isLoading,
}: {
  scopes: Scope[];
  currentScopeKey: string | null;
  onScopeSelect: (scope: Scope) => void;
  onAddGitHubOrg: () => void;
  hasGitHub: boolean;
  isLoading: boolean;
}) {
  const githubScopes = scopes.filter(
    (scope): scope is Extract<Scope, { kind: "github" }> =>
      scope.kind === "github",
  );
  const adoScopes = scopes.filter(
    (scope): scope is Extract<Scope, { kind: "azure_devops" }> =>
      scope.kind === "azure_devops",
  );

  return (
    <PopoverContent className="w-[260px] p-0" align="start">
      <Command>
        <CommandList>
          {isLoading && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Loading sources...</span>
            </div>
          )}
          {!isLoading && githubScopes.length > 0 && (
            <CommandGroup heading={hasGitHub ? "GitHub" : undefined}>
              {githubScopes.map((scope) => (
                <CommandItem
                  key={scope.key}
                  value={scope.key}
                  onSelect={() => onScopeSelect(scope)}
                >
                  <GitHubIcon className="size-3.5" />
                  <span className="truncate">{scope.label}</span>
                  <CheckIcon
                    className={cn(
                      "ml-auto size-3.5",
                      currentScopeKey === scope.key
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!isLoading && adoScopes.length > 0 && (
            <>
              {githubScopes.length > 0 && <CommandSeparator />}
              <CommandGroup heading="Azure DevOps">
                {adoScopes.map((scope) => (
                  <CommandItem
                    key={scope.key}
                    value={scope.key}
                    onSelect={() => onScopeSelect(scope)}
                  >
                    <AzureDevOpsIcon className="size-3.5 text-[#0078D4]" />
                    <span className="truncate">{scope.label}</span>
                    <CheckIcon
                      className={cn(
                        "ml-auto size-3.5",
                        currentScopeKey === scope.key
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>

        <div className="border-t border-border/70 p-1 dark:border-white/10">
          <button
            type="button"
            onClick={onAddGitHubOrg}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="size-3.5" />
            Add GitHub organization
          </button>
        </div>
      </Command>
    </PopoverContent>
  );
}
