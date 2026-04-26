"use client";

import { useEffect, useState } from "react";

export type ProviderId = "github" | "azure_devops";

interface ProviderTabsProps {
  value: ProviderId;
  onChange: (next: ProviderId) => void;
}

interface ProviderAvailability {
  github: boolean;
  azureDevOps: boolean;
}

async function fetchAvailability(): Promise<ProviderAvailability> {
  const [ghRes, adoRes] = await Promise.all([
    fetch("/api/github/connection-status").catch(() => null),
    fetch("/api/azure-devops/connection-status").catch(() => null),
  ]);
  const gh = ghRes && ghRes.ok ? await ghRes.json() : { enabled: false };
  const ado = adoRes && adoRes.ok ? await adoRes.json() : { enabled: false };
  return {
    github: gh.enabled !== false,
    azureDevOps: ado.enabled === true,
  };
}

export function ProviderTabs({ value, onChange }: ProviderTabsProps) {
  const [availability, setAvailability] = useState<ProviderAvailability | null>(
    null,
  );

  useEffect(() => {
    fetchAvailability().then(setAvailability);
  }, []);

  if (!availability) return null;

  const enabledCount =
    Number(availability.github) + Number(availability.azureDevOps);
  if (enabledCount === 0) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        No git provider is enabled in this deployment. Set GITHUB_ENABLED or
        AZURE_DEVOPS_ENABLED.
      </div>
    );
  }
  if (enabledCount === 1) {
    const single: ProviderId = availability.github ? "github" : "azure_devops";
    if (value !== single) onChange(single);
    return null;
  }

  return (
    <div className="inline-flex gap-1 rounded-md border p-1">
      {availability.github && (
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${
            value === "github"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => onChange("github")}
        >
          GitHub
        </button>
      )}
      {availability.azureDevOps && (
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${
            value === "azure_devops"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => onChange("azure_devops")}
        >
          Azure DevOps
        </button>
      )}
    </div>
  );
}
