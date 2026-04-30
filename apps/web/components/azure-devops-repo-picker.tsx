"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AdoProject {
  id: string;
  name: string;
}

interface AdoRepo {
  id: string;
  name: string;
  project: string;
  defaultBranch: string | null;
  webUrl: string;
}

export interface AzureDevOpsRepoSelection {
  org: string;
  project: string;
  repo: string;
  defaultBranch: string | null;
  webUrl: string;
}

interface Props {
  onSelect: (sel: AzureDevOpsRepoSelection) => void;
}

interface ProjectsResponse {
  org: string | null;
  projects: AdoProject[];
}

interface ReposResponse {
  repos: AdoRepo[];
}

export function AzureDevOpsRepoPicker({ onSelect }: Props) {
  const [org, setOrg] = useState<string | null>(null);
  const [projects, setProjects] = useState<AdoProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [repos, setRepos] = useState<AdoRepo[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingProjects(true);
    fetch("/api/azure-devops/projects", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: ProjectsResponse) => {
        if (controller.signal.aborted) return;
        setOrg(data.org);
        setProjects(data.projects);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError("Failed to load Azure DevOps projects");
        console.error("[ado-picker] projects fetch failed:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingProjects(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setIsLoadingRepos(true);
    fetch(`/api/azure-devops/projects/${encodeURIComponent(projectId)}/repos`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: ReposResponse) => {
        if (!controller.signal.aborted) setRepos(data.repos);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError("Failed to load repositories");
        console.error("[ado-picker] repos fetch failed:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingRepos(false);
      });
    return () => controller.abort();
  }, [projectId]);

  const filteredRepos = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return q ? repos.filter((r) => r.name.toLowerCase().includes(q)) : repos;
  }, [filter, repos]);

  if (error) {
    return (
      <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {org && (
        <p className="text-muted-foreground text-xs">
          Organization: <span className="font-mono">{org}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ado-project">Project</Label>
        <Select
          value={projectId ?? ""}
          onValueChange={(value) => setProjectId(value || null)}
          disabled={isLoadingProjects || projects.length === 0}
        >
          <SelectTrigger id="ado-project" className="w-full">
            <SelectValue
              placeholder={
                isLoadingProjects ? "Loading projects…" : "Select a project"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {projectId && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="ado-repo-filter">Repository</Label>
          <Input
            id="ado-repo-filter"
            placeholder="Filter repositories…"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={isLoadingRepos}
          />
          <ScrollArea className="h-64 rounded-md border">
            <ul className="divide-y">
              {isLoadingRepos ? (
                <li className="p-2 text-muted-foreground text-sm">
                  Loading repositories…
                </li>
              ) : filteredRepos.length === 0 ? (
                <li className="p-2 text-muted-foreground text-sm">
                  No repositories found.
                </li>
              ) : (
                filteredRepos.map((r) => (
                  <li key={r.id}>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      type="button"
                      onClick={() => {
                        if (!org) return;
                        onSelect({
                          org,
                          project: r.project,
                          repo: r.name,
                          defaultBranch: r.defaultBranch,
                          webUrl: r.webUrl,
                        });
                      }}
                    >
                      <span className="font-medium">{r.name}</span>
                      {r.defaultBranch && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          {r.defaultBranch}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
