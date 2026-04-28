import "server-only";
import type { Sandbox } from "@open-harness/sandbox";
import {
  getDeclaredProcessStatuses,
  launchDeclaredProcesses,
} from "@/lib/open-agents-config/processes";
import { readOpenAgentsConfigFromSandbox } from "@/lib/open-agents-config/sandbox-config";
import { runSetupCommands } from "@/lib/open-agents-config/setup";

const READY_CACHE_TTL_MS = 30_000;

const inFlight = new Map<string, Promise<void>>();
const lastReadyAt = new Map<string, number>();

function dedupeKey(sessionId: string, sandbox: Sandbox): string {
  let id: string | null = null;
  if (typeof sandbox.getState === "function") {
    try {
      const state = sandbox.getState();
      if (
        state &&
        typeof state === "object" &&
        "sandboxId" in state &&
        typeof (state as { sandboxId?: unknown }).sandboxId === "string"
      ) {
        id = (state as { sandboxId: string }).sandboxId;
      } else if (
        state &&
        typeof state === "object" &&
        "sandboxName" in state &&
        typeof (state as { sandboxName?: unknown }).sandboxName === "string"
      ) {
        id = (state as { sandboxName: string }).sandboxName;
      }
    } catch {
      // Fall through to sessionId-only key.
    }
  }
  return `${sessionId}:${id ?? "unknown"}`;
}

/**
 * Fire-and-forget: probe the dev server and launch any declared processes
 * that aren't already running, when `.open-agents/config.json` opts in via
 * `autostart: true` (the default). No-op for heuristic mode (no config).
 *
 * Concurrent calls for the same (sessionId, sandbox) are deduped via an
 * in-process map. A successful "all running" probe is cached for 30s so
 * that frequent sandbox connects (log streaming, message sends) don't pay
 * the probe cost on every call.
 */
export function maybeAutostartDevServer(args: {
  sandbox: Sandbox;
  sessionId: string;
}): void {
  const key = dedupeKey(args.sessionId, args.sandbox);

  if (inFlight.has(key)) {
    return;
  }

  const cachedAt = lastReadyAt.get(key);
  if (cachedAt !== undefined && Date.now() - cachedAt < READY_CACHE_TTL_MS) {
    return;
  }

  const promise = runAutostart(args.sandbox)
    .then((didAutostart) => {
      if (didAutostart === "ready") {
        lastReadyAt.set(key, Date.now());
      } else if (didAutostart === "skipped") {
        lastReadyAt.set(key, Date.now());
      }
    })
    .catch((error: unknown) => {
      console.error("Dev server autostart failed:", error);
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
}

async function runAutostart(
  sandbox: Sandbox,
): Promise<"ready" | "launched" | "skipped"> {
  const configRead = await readOpenAgentsConfigFromSandbox(sandbox).catch(
    () => null,
  );

  if (!configRead || configRead.kind !== "ok") {
    return "skipped";
  }

  if (configRead.config.autostart !== true) {
    return "skipped";
  }

  if (!sandbox.execDetached) {
    return "skipped";
  }

  const statuses = await getDeclaredProcessStatuses({
    sandbox,
    processes: configRead.config.dev,
  });
  if (statuses.every((s) => s.running)) {
    return "ready";
  }

  const setupResult = await runSetupCommands({
    sandbox,
    setup: configRead.config.setup,
    env: configRead.config.env,
  });
  if (!setupResult.ok) {
    console.error("Dev server autostart setup failed:", setupResult.failed);
    return "skipped";
  }

  const launch = await launchDeclaredProcesses({
    sandbox,
    processes: configRead.config.dev,
  });
  if (!launch.ok) {
    console.error("Dev server autostart launch failed:", launch.failed);
    return "skipped";
  }

  return "launched";
}

export const __testing = {
  reset: () => {
    inFlight.clear();
    lastReadyAt.clear();
  },
};
