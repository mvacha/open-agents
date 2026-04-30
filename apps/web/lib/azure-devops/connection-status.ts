import "server-only";
import { isAzureDevOpsEnabled } from "@/lib/git-providers/feature-flags";
import { getAdoClient } from "./client";
import { getAzureDevOpsConfig } from "./config";

export type AdoConnectionStatus =
  | { enabled: false }
  | { enabled: true; healthy: true; org: string }
  | {
      enabled: true;
      healthy: false;
      reason:
        | "missing_org_or_pat"
        | "pat_invalid"
        | "pat_insufficient_scope"
        | "network_error";
      org: string | null;
    };

interface CacheEntry {
  expiresAt: number;
  status: AdoConnectionStatus;
}

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

interface ProbeResult {
  ok: boolean;
  reason?: "pat_invalid" | "pat_insufficient_scope" | "network_error";
}

interface GetAdoConnectionStatusOptions {
  probe?: () => Promise<ProbeResult>;
  bypassCache?: boolean;
}

export async function getAdoConnectionStatus(
  options: GetAdoConnectionStatusOptions = {},
): Promise<AdoConnectionStatus> {
  if (!options.bypassCache && cache && cache.expiresAt > Date.now()) {
    return cache.status;
  }

  const config = getAzureDevOpsConfig();
  if (!config.enabled) {
    // Distinguish "flag not set" from "flag set but org/PAT missing" so the
    // settings UI can surface a warning chip instead of hiding the section.
    if (isAzureDevOpsEnabled()) {
      const status: AdoConnectionStatus = {
        enabled: true,
        healthy: false,
        reason: "missing_org_or_pat",
        org: process.env.AZURE_DEVOPS_ORG?.trim() || null,
      };
      cache = { expiresAt: Date.now() + CACHE_TTL_MS, status };
      return status;
    }
    const status: AdoConnectionStatus = { enabled: false };
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, status };
    return status;
  }

  const probe = options.probe ?? defaultProbe;
  const result = await probe();

  const status: AdoConnectionStatus = result.ok
    ? { enabled: true, healthy: true, org: config.org }
    : {
        enabled: true,
        healthy: false,
        reason: result.reason ?? "network_error",
        org: config.org,
      };

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, status };
  return status;
}

async function defaultProbe(): Promise<ProbeResult> {
  const client = getAdoClient();
  if (!client) {
    return { ok: false, reason: "network_error" };
  }
  try {
    await client.listProjects();
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/401|unauthor/i.test(message)) {
      return { ok: false, reason: "pat_invalid" };
    }
    if (/403|forbidden|scope/i.test(message)) {
      return { ok: false, reason: "pat_insufficient_scope" };
    }
    return { ok: false, reason: "network_error" };
  }
}

export function __resetAdoConnectionStatusCacheForTesting(): void {
  cache = null;
}
