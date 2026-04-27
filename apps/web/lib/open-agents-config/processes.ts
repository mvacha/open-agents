import "server-only";
import type { Sandbox } from "@open-harness/sandbox";
import type { DevProcess } from "./schema";
import {
  pidFilePath,
  pidsDirPath,
  processCwdPath,
  shellQuote,
} from "./sandbox-paths";

const PID_KILL_TIMEOUT_MS = 5_000;

type LaunchSandbox = Pick<
  Sandbox,
  | "exec"
  | "execDetached"
  | "readFile"
  | "readdir"
  | "writeFile"
  | "mkdir"
  | "workingDirectory"
>;

export interface LaunchedProcess {
  name: string;
  cwd: string;
  port: number;
}

export type LaunchResult =
  | { ok: true; processes: LaunchedProcess[] }
  | {
      ok: false;
      failed: {
        name: string;
        exitCode: number | null;
        stderr: string;
      };
    };

export interface StoppedProcess {
  name: string;
  pid: string | null;
}

async function ensurePidsDir(sandbox: LaunchSandbox): Promise<void> {
  if (!sandbox.mkdir) {
    return;
  }
  await sandbox.mkdir(pidsDirPath(sandbox.workingDirectory), {
    recursive: true,
  });
}

async function readPid(
  sandbox: LaunchSandbox,
  name: string,
): Promise<string | null> {
  try {
    const raw = (
      await sandbox.readFile(
        pidFilePath(sandbox.workingDirectory, name),
        "utf-8",
      )
    ).trim();
    return /^[1-9][0-9]*$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function pidIsAlive(
  sandbox: LaunchSandbox,
  pid: string,
): Promise<boolean> {
  const result = await sandbox.exec(
    `kill -0 ${pid}`,
    sandbox.workingDirectory,
    PID_KILL_TIMEOUT_MS,
  );
  return result.success;
}

async function removePidFile(
  sandbox: LaunchSandbox,
  name: string,
): Promise<void> {
  await sandbox.exec(
    `rm -f ${shellQuote(pidFilePath(sandbox.workingDirectory, name))}`,
    sandbox.workingDirectory,
    PID_KILL_TIMEOUT_MS,
  );
}

async function killPid(sandbox: LaunchSandbox, pid: string): Promise<void> {
  await sandbox
    .exec(
      `kill ${pid} 2>/dev/null || true`,
      sandbox.workingDirectory,
      PID_KILL_TIMEOUT_MS,
    )
    .catch(() => undefined);
}

function buildLaunchCommand(args: {
  workingDirectory: string;
  process: DevProcess;
}): string {
  const pidPath = pidFilePath(args.workingDirectory, args.process.name);
  return `printf '%s' "$$" > ${shellQuote(pidPath)} && exec bash -c ${shellQuote(args.process.run)}`;
}

async function rollbackLaunchedSiblings(
  sandbox: LaunchSandbox,
  launched: LaunchedProcess[],
): Promise<void> {
  for (const sibling of launched) {
    const pid = await readPid(sandbox, sibling.name);
    if (pid) {
      await killPid(sandbox, pid);
    }
    await removePidFile(sandbox, sibling.name);
  }
}

export async function launchDeclaredProcesses(args: {
  sandbox: LaunchSandbox;
  processes: readonly DevProcess[];
}): Promise<LaunchResult> {
  const { sandbox, processes } = args;
  await ensurePidsDir(sandbox);

  const launched: LaunchedProcess[] = [];

  for (const process of processes) {
    const existingPid = await readPid(sandbox, process.name);
    if (existingPid && (await pidIsAlive(sandbox, existingPid))) {
      launched.push({
        name: process.name,
        cwd: process.cwd,
        port: process.port,
      });
      continue;
    }

    if (existingPid) {
      await removePidFile(sandbox, process.name);
    }

    const cwdAbs = processCwdPath(sandbox.workingDirectory, process.cwd);
    const command = buildLaunchCommand({
      workingDirectory: sandbox.workingDirectory,
      process,
    });

    try {
      if (!sandbox.execDetached) {
        throw new Error("Sandbox does not support background commands");
      }
      await sandbox.execDetached(command, cwdAbs);
      launched.push({
        name: process.name,
        cwd: process.cwd,
        port: process.port,
      });
    } catch (error) {
      await rollbackLaunchedSiblings(sandbox, launched);
      const message = error instanceof Error ? error.message : String(error);
      const exitCodeMatch = message.match(/exited with code (-?\d+)/);
      const exitCode = exitCodeMatch?.[1]
        ? Number.parseInt(exitCodeMatch[1], 10)
        : null;
      return {
        ok: false,
        failed: {
          name: process.name,
          exitCode,
          stderr: message,
        },
      };
    }
  }

  return { ok: true, processes: launched };
}

export async function stopDeclaredProcesses(args: {
  sandbox: LaunchSandbox;
}): Promise<StoppedProcess[]> {
  const { sandbox } = args;
  const dir = pidsDirPath(sandbox.workingDirectory);

  let entries;
  try {
    entries = await sandbox.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pid"))
    .map((entry) => entry.name);

  const stopped: StoppedProcess[] = [];

  for (const filename of filenames) {
    const name = filename.replace(/\.pid$/, "");
    const pid = await readPid(sandbox, name);

    if (pid) {
      await killPid(sandbox, pid);
    }
    await removePidFile(sandbox, name);

    stopped.push({ name, pid });
  }

  return stopped;
}
