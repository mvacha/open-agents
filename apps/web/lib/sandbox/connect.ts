import "server-only";
import {
  type ConnectOptions,
  // eslint-disable-next-line no-restricted-imports -- this wrapper is the only legitimate session-aware caller of connectSandbox.
  connectSandbox,
  type SandboxState,
} from "@open-harness/sandbox";
import { maybeAutostartDevServer } from "./dev-server-autostart";
import { makeSandboxLogHook } from "./log-buffer";

/**
 * Session-scoped wrapper around `connectSandbox` that always wires the
 * `onLog` hook to the in-memory log buffer streamed to the UI via
 * `/api/sessions/:sessionId/sandbox-logs/stream`.
 *
 * Also fires a fire-and-forget dev server autostart probe — if
 * `.open-agents/config.json` exists with `autostart: true` (the default)
 * and the declared processes aren't already running, they get launched.
 *
 * Use this everywhere a sandbox is connected on behalf of a session.
 * Call `connectSandbox` directly only when there is no session
 * (e.g. base-snapshot refresh tooling, tests).
 */
export async function connectSandboxForSession(
  sandboxState: SandboxState,
  sessionId: string,
  options?: ConnectOptions,
): ReturnType<typeof connectSandbox> {
  const sandbox = await connectSandbox(sandboxState, {
    ...options,
    hooks: {
      ...options?.hooks,
      onLog: options?.hooks?.onLog ?? makeSandboxLogHook(sessionId),
    },
  });

  maybeAutostartDevServer({ sandbox, sessionId });

  return sandbox;
}
