"use client";

import { useEffect, useState } from "react";

export type ProviderId = "github" | "azure_devops";

interface ProviderTabsProps {
  value: ProviderId;
  onChange: (next: ProviderId) => void;
}

interface ProviderAvailability {
  github: { enabled: boolean; healthy: boolean };
  azureDevOps: { enabled: boolean; healthy: boolean };
}

async function fetchAvailability(
  signal: AbortSignal,
): Promise<ProviderAvailability> {
  const [ghRes, adoRes] = await Promise.all([
    fetch("/api/github/connection-status", { signal }).catch(() => null),
    fetch("/api/azure-devops/connection-status", { signal }).catch(() => null),
  ]);
  const gh = ghRes && ghRes.ok ? await ghRes.json() : { enabled: false };
  const ado = adoRes && adoRes.ok ? await adoRes.json() : { enabled: false };

  // GitHub: { enabled?: false } | { status: "connected" | "reconnect_required" | "not_connected", ... }
  // Treat any GitHub response that isn't { enabled: false } as enabled. Healthy when status === "connected".
  const ghEnabled = gh.enabled !== false;
  const ghHealthy = ghEnabled && gh.status === "connected";

  // ADO: { enabled: false } | { enabled: true, healthy: true | false }
  const adoEnabled = ado.enabled === true;
  const adoHealthy = adoEnabled && ado.healthy === true;

  return {
    github: { enabled: ghEnabled, healthy: ghHealthy },
    azureDevOps: { enabled: adoEnabled, healthy: adoHealthy },
  };
}

export function ProviderTabs({ value, onChange }: ProviderTabsProps) {
  const [availability, setAvailability] = useState<ProviderAvailability | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const next = await fetchAvailability(controller.signal);
        if (!controller.signal.aborted) setAvailability(next);
      } catch {
        // network errors are handled by fetchAvailability returning enabled:false
      }
    })();
    return () => controller.abort();
  }, []);

  // Auto-select the only enabled provider when exactly one is available.
  // Runs as an effect to avoid setState-during-render warnings.
  useEffect(() => {
    if (!availability) return;
    const enabled =
      Number(availability.github.enabled) +
      Number(availability.azureDevOps.enabled);
    if (enabled !== 1) return;
    const single: ProviderId = availability.github.enabled
      ? "github"
      : "azure_devops";
    if (value !== single) onChange(single);
  }, [availability, value, onChange]);

  if (!availability) return null;

  const enabledCount =
    Number(availability.github.enabled) +
    Number(availability.azureDevOps.enabled);
  if (enabledCount === 0) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        No git provider is enabled in this deployment. Set GITHUB_ENABLED or
        AZURE_DEVOPS_ENABLED.
      </div>
    );
  }
  if (enabledCount === 1) {
    return null;
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex gap-1 rounded-md border p-1">
        {availability.github.enabled && (
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
            {!availability.github.healthy && (
              <span
                className="ml-1.5 text-amber-600 text-xs"
                title="Reconnect needed"
              >
                ⚠
              </span>
            )}
          </button>
        )}
        {availability.azureDevOps.enabled && (
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
            {!availability.azureDevOps.healthy && (
              <span
                className="ml-1.5 text-amber-600 text-xs"
                title="Provider unhealthy"
              >
                ⚠
              </span>
            )}
          </button>
        )}
      </div>
      {value === "azure_devops" && !availability.azureDevOps.healthy && (
        <p className="text-amber-700 text-xs">
          Azure DevOps is enabled but unhealthy. Check AZURE_DEVOPS_PAT.
        </p>
      )}
      {value === "github" &&
        availability.github.enabled &&
        !availability.github.healthy && (
          <p className="text-amber-700 text-xs">
            GitHub needs to be reconnected.
          </p>
        )}
    </div>
  );
}
