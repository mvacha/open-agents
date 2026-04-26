import "server-only";
import { getAdoClient } from "./client";
import { getAzureDevOpsConfig } from "./config";

export type AdoConnectionStatus =
  | { enabled: false }
  | { enabled: true; healthy: true }
  | {
      enabled: true;
      healthy: false;
      reason: "pat_invalid" | "pat_insufficient_scope" | "network_error";
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
    const status: AdoConnectionStatus = { enabled: false };
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, status };
    return status;
  }

  const probe = options.probe ?? defaultProbe;
  const result = await probe();

  const status: AdoConnectionStatus = result.ok
    ? { enabled: true, healthy: true }
    : {
        enabled: true,
        healthy: false,
        reason: result.reason ?? "network_error",
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
