"use client";

import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    fetch("/api/azure-devops/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: ProjectsResponse) => {
        setOrg(data.org);
        setProjects(data.projects);
      })
      .catch(() => setError("Failed to load Azure DevOps projects"));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/azure-devops/projects/${encodeURIComponent(projectId)}/repos`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: ReposResponse) => setRepos(data.repos))
      .catch(() => setError("Failed to load repositories"));
  }, [projectId]);

  const filteredRepos = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return q ? repos.filter((r) => r.name.toLowerCase().includes(q)) : repos;
  }, [filter, repos]);

  if (error) return <div className="text-red-700 text-sm">{error}</div>;

  return (
    <div className="flex flex-col gap-3">
      {org && (
        <div className="text-muted-foreground text-xs">
          Organization: <span className="font-mono">{org}</span>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <span>Project</span>
        <select
          className="rounded border bg-background p-1"
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value || null)}
        >
          <option value="">Select…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {projectId && (
        <>
          <input
            className="rounded border bg-background p-1 text-sm"
            placeholder="Filter repos…"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="max-h-64 divide-y overflow-y-auto rounded border">
            {filteredRepos.length === 0 ? (
              <li className="p-2 text-muted-foreground text-sm">
                No repositories found.
              </li>
            ) : (
              filteredRepos.map((r) => (
                <li key={r.id}>
                  <button
                    className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted"
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
                    {r.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
