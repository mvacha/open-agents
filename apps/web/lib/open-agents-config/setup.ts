import "server-only";
import type { Sandbox } from "@open-harness/sandbox";
import { setupMarkerPath } from "./sandbox-paths";
import { computeSetupHash } from "./setup-hash";

const SETUP_TIMEOUT_MS = 10 * 60 * 1000;

export type SetupResult =
  | { ok: true }
  | {
      ok: false;
      failed: { command: string; exitCode: number | null; stderr: string };
    };

type SandboxSetupCapabilities = Pick<
  Sandbox,
  "exec" | "readFile" | "writeFile" | "workingDirectory"
>;

async function readSetupMarker(
  sandbox: SandboxSetupCapabilities,
): Promise<string | null> {
  try {
    return (
      await sandbox.readFile(setupMarkerPath(sandbox.workingDirectory), "utf-8")
    ).trim();
  } catch {
    return null;
  }
}

async function writeSetupMarker(
  sandbox: SandboxSetupCapabilities,
  hash: string,
): Promise<void> {
  await sandbox.writeFile(
    setupMarkerPath(sandbox.workingDirectory),
    hash,
    "utf-8",
  );
}

export async function runSetupCommands(args: {
  sandbox: SandboxSetupCapabilities;
  setup: readonly string[] | undefined;
  env?: Record<string, string>;
}): Promise<SetupResult> {
  const { sandbox, setup, env } = args;
  const hash = computeSetupHash({ setup, env });
  const existing = await readSetupMarker(sandbox);

  if (existing === hash) {
    return { ok: true };
  }

  for (const command of setup ?? []) {
    const result = await sandbox.exec(
      command,
      sandbox.workingDirectory,
      SETUP_TIMEOUT_MS,
    );
    if (!result.success) {
      return {
        ok: false,
        failed: {
          command,
          exitCode: result.exitCode,
          stderr: result.stderr || result.stdout,
        },
      };
    }
  }

  await writeSetupMarker(sandbox, hash);
  return { ok: true };
}
