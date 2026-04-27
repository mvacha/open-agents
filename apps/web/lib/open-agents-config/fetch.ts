import "server-only";
import type { GitProvider, RepoRef } from "@/lib/git-providers/types";
import {
  OPEN_AGENTS_CONFIG_RELATIVE_PATH,
  type OpenAgentsConfig,
  parseOpenAgentsConfigFromJson,
} from "./schema";

export type FetchOpenAgentsConfigResult =
  | { kind: "ok"; config: OpenAgentsConfig }
  | { kind: "missing" }
  | { kind: "invalid"; error: string }
  | { kind: "error"; error: string };

/**
 * Pre-fetch the project's `.open-agents/config.json` from the git provider
 * before the sandbox is created. The result is best-effort: any transient
 * failure should not block sandbox creation, so callers can fall through
 * to default ports.
 */
export async function fetchOpenAgentsConfigFromProvider(args: {
  provider: GitProvider;
  ref: RepoRef;
  branch: string;
  token: string;
}): Promise<FetchOpenAgentsConfigResult> {
  let raw: string | null;
  try {
    raw = await args.provider.fetchRepoFile({
      ref: args.ref,
      branch: args.branch,
      path: OPEN_AGENTS_CONFIG_RELATIVE_PATH,
      token: args.token,
    });
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (raw === null) {
    return { kind: "missing" };
  }

  const parsed = parseOpenAgentsConfigFromJson(raw);
  if (parsed.kind === "invalid") {
    return { kind: "invalid", error: parsed.error };
  }

  return { kind: "ok", config: parsed.config };
}

export function uniquePortsFromConfig(config: OpenAgentsConfig): number[] {
  const ports = config.dev.map((p) => p.port);
  return Array.from(new Set(ports));
}

export function envFromConfig(
  config: OpenAgentsConfig,
): Record<string, string> | undefined {
  if (!config.env || Object.keys(config.env).length === 0) {
    return undefined;
  }
  return { ...config.env };
}
