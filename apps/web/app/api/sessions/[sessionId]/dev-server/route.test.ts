import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const DEV_SERVER_PID_FILE =
  "/vercel/sandbox/apps/web/.open-harness-dev-server-3000.pid";
const DEV_SERVER_STATE_FILE =
  "/vercel/sandbox/.open-harness-dev-server-state.json";
const RUNNING_PID = "4242";

const currentSessionRecord = {
  userId: "user-1",
  sandboxState: {
    type: "vercel" as const,
    sandboxId: "sandbox-1",
    expiresAt: Date.now() + 60_000,
  } as {
    type: "vercel";
    sandboxId: string;
    expiresAt: number;
    ports?: number[];
  },
};

type MockPathEntry = {
  type: "file" | "directory";
  mtimeMs: number;
  size: number;
};

let currentFindOutput = "./package.json\n./apps/web/package.json\n";
let fileContents = new Map<string, string>();
let existingPaths = new Set<string>();
let pathEntries = new Map<string, MockPathEntry>();
let runningPids = new Set<string>();
let lastLaunchCommand: string | null = null;
let lastLaunchCwd: string | null = null;
let currentMtimeMs = 1_000;
let configSetupCommands = new Map<
  string,
  () => ReturnType<typeof successResult>
>();
let detachedLaunches: { command: string; cwd: string }[] = [];
let detachedFailures = new Map<number, string>();

function successResult(stdout = "") {
  return {
    success: true,
    exitCode: 0,
    stdout,
    stderr: "",
    truncated: false,
  };
}

function failureResult(stderr: string) {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr,
    truncated: false,
  };
}

function nextMtime(): number {
  currentMtimeMs += 100;
  return currentMtimeMs;
}

function setMockFile(filePath: string, content: string, mtimeMs = nextMtime()) {
  fileContents.set(filePath, content);
  existingPaths.add(filePath);
  pathEntries.set(filePath, {
    type: "file",
    mtimeMs,
    size: content.length,
  });
}

function setMockDirectory(dirPath: string, mtimeMs = nextMtime()) {
  existingPaths.add(dirPath);
  pathEntries.set(dirPath, {
    type: "directory",
    mtimeMs,
    size: 0,
  });
}

function removeMockPath(targetPath: string) {
  existingPaths.delete(targetPath);
  fileContents.delete(targetPath);
  pathEntries.delete(targetPath);
}

function seedDefaultWorkspace() {
  currentFindOutput = "./package.json\n./apps/web/package.json\n";

  setMockDirectory("/vercel/sandbox");
  setMockDirectory("/vercel/sandbox/apps");
  setMockDirectory("/vercel/sandbox/apps/web");

  setMockFile(
    "/vercel/sandbox/package.json",
    JSON.stringify({
      packageManager: "bun@1.2.14",
      scripts: {
        dev: "turbo dev",
      },
    }),
  );
  setMockFile(
    "/vercel/sandbox/apps/web/package.json",
    JSON.stringify({
      scripts: {
        dev: "next dev",
      },
      dependencies: {
        next: "15.0.0",
      },
    }),
  );
  setMockFile("/vercel/sandbox/bun.lock", "");
}

const requireAuthenticatedUserMock = mock(async () => ({
  ok: true as const,
  userId: "user-1",
}));
const requireOwnedSessionWithSandboxGuardMock = mock(async () => ({
  ok: true as const,
  sessionRecord: currentSessionRecord,
}));
const execMock = mock(async (command: string) => {
  if (command.includes("find .")) {
    return successResult(currentFindOutput);
  }

  if (command.startsWith("kill -0 ")) {
    const pid = command.slice("kill -0 ".length).trim();
    return runningPids.has(pid)
      ? successResult()
      : failureResult(`No such process: ${pid}`);
  }

  if (command.startsWith("kill ")) {
    const pid = command.match(/^kill ([0-9]+)/)?.[1];
    if (pid) {
      runningPids.delete(pid);
    }
    return successResult();
  }

  if (command.startsWith("rm -f ")) {
    const filePath = command.match(/^rm -f '(.+)'$/)?.[1];
    if (filePath) {
      removeMockPath(filePath);
    }
    return successResult();
  }

  if (configSetupCommands.has(command)) {
    const handler = configSetupCommands.get(command);
    if (handler) {
      return handler();
    }
  }

  throw new Error(`Unexpected exec command: ${command}`);
});
const readFileMock = mock(async (filePath: string) => {
  const content = fileContents.get(filePath);
  if (content === undefined) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return content;
});
const writeFileMock = mock(async (filePath: string, content: string) => {
  setMockFile(filePath, content);
});
const statMock = mock(async (filePath: string) => {
  const entry = pathEntries.get(filePath);
  if (!entry) {
    throw new Error(`ENOENT: ${filePath}`);
  }

  return {
    isDirectory: () => entry.type === "directory",
    isFile: () => entry.type === "file",
    size: entry.size,
    mtimeMs: entry.mtimeMs,
  };
});
const accessMock = mock(async (filePath: string) => {
  if (!existingPaths.has(filePath)) {
    throw new Error(`ENOENT: ${filePath}`);
  }
});
const execDetachedMock = mock(async (command: string, cwd: string) => {
  lastLaunchCommand = command;
  lastLaunchCwd = cwd;
  detachedLaunches.push({ command, cwd });

  const failureMessage = detachedFailures.get(detachedLaunches.length);
  if (failureMessage !== undefined) {
    throw new Error(failureMessage);
  }

  const declaredPidPath = command.match(
    /> '([^']+\.open-agents\/.pids\/[a-z0-9-]+\.pid)'/i,
  )?.[1];
  if (declaredPidPath) {
    const pid = `${10000 + detachedLaunches.length}`;
    setMockFile(declaredPidPath, pid);
    runningPids.add(pid);
    return { commandId: `cmd-${detachedLaunches.length}` };
  }

  const pidFilePath = command.match(
    /> '([^']+\.open-harness-dev-server-[0-9]+\.pid)'/,
  )?.[1];
  if (pidFilePath) {
    setMockFile(pidFilePath, `${RUNNING_PID}\n`);
    runningPids.add(RUNNING_PID);
  }

  return { commandId: "cmd-1" };
});
const mkdirMock = mock(async (dirPath: string) => {
  setMockDirectory(dirPath);
});
const readdirMock = mock(async (dirPath: string) => {
  const entry = pathEntries.get(dirPath);
  if (!entry || entry.type !== "directory") {
    throw new Error(`ENOENT: ${dirPath}`);
  }
  const prefix = `${dirPath.replace(/\/$/, "")}/`;
  const names = [...existingPaths]
    .filter(
      (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"),
    )
    .map((p) => p.slice(prefix.length))
    .filter((name) => name.length > 0);
  return names.map((name) => {
    const child = pathEntries.get(`${prefix}${name}`);
    const isDir = child?.type === "directory";
    return {
      name,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
    };
  });
});
const domainMock = mock((port: number) => `https://sb-${port}.vercel.run`);
const connectSandboxMock = mock(async () => ({
  workingDirectory: "/vercel/sandbox",
  exec: execMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  stat: statMock,
  access: accessMock,
  execDetached: execDetachedMock,
  mkdir: mkdirMock,
  readdir: readdirMock,
  domain: domainMock,
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSessionWithSandboxGuard: requireOwnedSessionWithSandboxGuardMock,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: connectSandboxMock,
}));

const routeModulePromise = import("./route");

function createRouteContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/dev-server", () => {
  beforeEach(() => {
    currentMtimeMs = 1_000;
    fileContents = new Map();
    existingPaths = new Set<string>();
    pathEntries = new Map<string, MockPathEntry>();
    seedDefaultWorkspace();
    runningPids = new Set<string>();
    lastLaunchCommand = null;
    lastLaunchCwd = null;
    detachedLaunches = [];
    detachedFailures = new Map();
    configSetupCommands = new Map();
    currentSessionRecord.sandboxState.expiresAt = Date.now() + 60_000;
    currentSessionRecord.sandboxState.ports = undefined;
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionWithSandboxGuardMock.mockClear();
    connectSandboxMock.mockClear();
    execMock.mockClear();
    readFileMock.mockClear();
    writeFileMock.mockClear();
    statMock.mockClear();
    accessMock.mockClear();
    execDetachedMock.mockClear();
    mkdirMock.mockClear();
    readdirMock.mockClear();
    domainMock.mockClear();
  });

  test("prefers a direct app dev script over a root workspace orchestrator and returns its preview URL", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      mode: string;
      packagePath: string;
      port: number;
      url: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      mode: "heuristic",
      packagePath: "apps/web",
      port: 3000,
      url: "https://sb-3000.vercel.run",
    });
    expect(connectSandboxMock).toHaveBeenCalledWith(
      currentSessionRecord.sandboxState,
      expect.objectContaining({ ports: [3000, 5173, 4321, 8000] }),
    );
    expect(execDetachedMock).toHaveBeenCalledTimes(1);
    expect(lastLaunchCwd).toBe("/vercel/sandbox/apps/web");
    expect(lastLaunchCommand).not.toBeNull();
    expect(existingPaths.has(DEV_SERVER_PID_FILE)).toBe(true);
    expect(existingPaths.has(DEV_SERVER_STATE_FILE)).toBe(true);
    expect(fileContents.get(DEV_SERVER_STATE_FILE)).toBe(
      JSON.stringify({ packageDir: "apps/web", port: 3000 }),
    );
    expect(runningPids.has(RUNNING_PID)).toBe(true);

    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).toContain(DEV_SERVER_PID_FILE);
    expect(lastLaunchCommand).toContain("bun install");
    expect(lastLaunchCommand).toContain("bun run dev");
    expect(lastLaunchCommand).toContain("--hostname 0.0.0.0 --port 3000");
  });

  test("returns the existing preview URL without relaunching when the dev server is already running", async () => {
    const { POST } = await routeModulePromise;

    setMockFile(DEV_SERVER_PID_FILE, `${RUNNING_PID}\n`);
    setMockFile(
      DEV_SERVER_STATE_FILE,
      JSON.stringify({ packageDir: "apps/web", port: 3000 }),
    );
    runningPids.add(RUNNING_PID);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      mode: string;
      packagePath: string;
      port: number;
      url: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      mode: "heuristic",
      packagePath: "apps/web",
      port: 3000,
      url: "https://sb-3000.vercel.run",
    });
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });

  test("keeps using the launched app when package discovery later prefers another app", async () => {
    const { POST } = await routeModulePromise;

    const firstResponse = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    expect(firstResponse.status).toBe(200);

    setMockDirectory("/vercel/sandbox/apps/admin");
    setMockFile(
      "/vercel/sandbox/apps/admin/package.json",
      JSON.stringify({
        scripts: {
          dev: "next dev",
        },
        dependencies: {
          next: "15.0.0",
        },
      }),
    );
    currentFindOutput =
      "./apps/admin/package.json\n./apps/web/package.json\n./package.json\n";

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      mode: string;
      packagePath: string;
      port: number;
      url: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      mode: "heuristic",
      packagePath: "apps/web",
      port: 3000,
      url: "https://sb-3000.vercel.run",
    });
    expect(execDetachedMock).toHaveBeenCalledTimes(1);
  });

  test("stops the running dev server even when package discovery later prefers another app", async () => {
    const { DELETE, POST } = await routeModulePromise;

    const launchResponse = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    expect(launchResponse.status).toBe(200);

    setMockDirectory("/vercel/sandbox/apps/admin");
    setMockFile(
      "/vercel/sandbox/apps/admin/package.json",
      JSON.stringify({
        scripts: {
          dev: "next dev",
        },
        dependencies: {
          next: "15.0.0",
        },
      }),
    );
    currentFindOutput =
      "./apps/admin/package.json\n./apps/web/package.json\n./package.json\n";

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "DELETE",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      mode: string;
      stopped: boolean;
      packagePath: string;
      port: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      mode: "heuristic",
      stopped: true,
      packagePath: "apps/web",
      port: 3000,
    });
    expect(runningPids.has(RUNNING_PID)).toBe(false);
    expect(existingPaths.has(DEV_SERVER_PID_FILE)).toBe(false);
    expect(existingPaths.has(DEV_SERVER_STATE_FILE)).toBe(false);
  });

  test("reinstalls dependencies when a package manifest changed after node_modules was created", async () => {
    const { POST } = await routeModulePromise;

    setMockDirectory("/vercel/sandbox/node_modules", 5_000);
    setMockFile(
      "/vercel/sandbox/apps/web/package.json",
      JSON.stringify({
        scripts: {
          dev: "next dev",
        },
        dependencies: {
          next: "15.0.0",
          react: "19.0.0",
        },
      }),
      6_000,
    );

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );

    expect(response.status).toBe(200);
    expect(lastLaunchCommand).not.toBeNull();

    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).toContain("bun install");
  });

  test("skips dependency install when node_modules is newer than manifests and lockfiles", async () => {
    const { POST } = await routeModulePromise;

    setMockDirectory("/vercel/sandbox/node_modules", 10_000);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );

    expect(response.status).toBe(200);
    expect(lastLaunchCommand).not.toBeNull();

    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).not.toContain("bun install");
  });

  test("returns 404 when no supported dev script is found", async () => {
    const { POST } = await routeModulePromise;

    fileContents = new Map();
    existingPaths = new Set<string>();
    pathEntries = new Map<string, MockPathEntry>();
    setMockDirectory("/vercel/sandbox");
    setMockFile(
      "/vercel/sandbox/package.json",
      JSON.stringify({
        scripts: {
          test: "bun test",
        },
      }),
    );
    currentFindOutput = "./package.json\n";

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      "No supported dev script found in package.json files",
    );
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });

  test("GET returns heuristic stopped when no persisted state exists", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/dev-server"),
      createRouteContext(),
    );
    const body = (await response.json()) as { mode: string; status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ mode: "heuristic", status: "stopped" });
    expect(detachedLaunches).toHaveLength(0);
  });

  test("GET returns heuristic ready when a persisted dev server is alive", async () => {
    const { GET, POST } = await routeModulePromise;

    const launch = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    expect(launch.status).toBe(200);
    const detachedBefore = detachedLaunches.length;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/dev-server"),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      mode: string;
      status: string;
      packagePath: string;
      port: number;
      url: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      mode: "heuristic",
      status: "ready",
      packagePath: "apps/web",
      port: 3000,
      url: "https://sb-3000.vercel.run",
    });
    // GET must never launch.
    expect(detachedLaunches.length).toBe(detachedBefore);
  });

  describe("declared path", () => {
    function seedDeclaredConfig(config: unknown) {
      setMockDirectory("/vercel/sandbox/.open-agents");
      setMockFile(
        "/vercel/sandbox/.open-agents/config.json",
        JSON.stringify(config),
      );
    }

    test("launches a single declared process and exposes a url for it", async () => {
      const { POST } = await routeModulePromise;
      seedDeclaredConfig({
        dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
      });

      const response = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        mode: string;
        processes: Array<{
          name: string;
          cwd: string;
          url?: string;
          port: number;
        }>;
      };

      expect(response.status).toBe(200);
      expect(body).toEqual({
        mode: "declared",
        processes: [
          {
            name: "web",
            cwd: "apps/web",
            port: 5173,
            url: "https://sb-5173.vercel.run",
          },
        ],
      });
      expect(detachedLaunches).toHaveLength(1);
      expect(detachedLaunches[0]?.cwd).toBe("/vercel/sandbox/apps/web");
      expect(detachedLaunches[0]?.command).toContain(
        "/vercel/sandbox/.open-agents/.pids/web.pid",
      );
      expect(
        existingPaths.has("/vercel/sandbox/.open-agents/.pids/web.pid"),
      ).toBe(true);
    });

    test("launches N processes sequentially and only the first gets a url", async () => {
      const { POST } = await routeModulePromise;
      currentSessionRecord.sandboxState.ports = [5173, 3001];
      seedDeclaredConfig({
        dev: [
          { name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" },
          { name: "api", run: "bun run api", port: 3001, cwd: "apps/api" },
        ],
      });

      const response = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        mode: string;
        processes: Array<{ name: string; url?: string; port: number }>;
      };

      expect(response.status).toBe(200);
      expect(body.mode).toBe("declared");
      expect(body.processes).toHaveLength(2);
      expect(body.processes[0]?.url).toBe("https://sb-5173.vercel.run");
      expect(body.processes[1]?.url).toBeUndefined();
      expect(detachedLaunches.map((l) => l.command).join("\n")).toMatch(
        /web\.pid[\s\S]*api\.pid/,
      );
    });

    test("rolls back launched siblings when a later process fails", async () => {
      const { POST } = await routeModulePromise;
      currentSessionRecord.sandboxState.ports = [5173, 3001, 4000];
      seedDeclaredConfig({
        dev: [
          { name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" },
          { name: "api", run: "bun run api", port: 3001, cwd: "apps/api" },
          { name: "worker", run: "bun run wk", port: 4000, cwd: "." },
        ],
      });
      detachedFailures.set(
        2,
        "Background command exited with code 127. stderr:\nbun: command not found",
      );

      const response = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        error: string;
        failed: { name: string; exitCode: number | null };
      };

      expect(response.status).toBe(500);
      expect(body.error).toContain('"api"');
      expect(body.failed.name).toBe("api");
      expect(body.failed.exitCode).toBe(127);
      expect(detachedLaunches).toHaveLength(2);
      expect(
        existingPaths.has("/vercel/sandbox/.open-agents/.pids/web.pid"),
      ).toBe(false);
    });

    test("returns 422 when config.json is invalid", async () => {
      const { POST } = await routeModulePromise;
      seedDeclaredConfig({ dev: [] });

      const response = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        error: string;
        details: string;
      };

      expect(response.status).toBe(422);
      expect(body.error).toContain("invalid");
      expect(body.details.length).toBeGreaterThan(0);
    });

    test("returns 409 when declared ports are not exposed by the sandbox", async () => {
      const { POST } = await routeModulePromise;
      seedDeclaredConfig({
        dev: [{ name: "web", run: "bun run dev", port: 9000, cwd: "apps/web" }],
      });

      const response = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        error: string;
        expected: number[];
        actual: number[];
      };

      expect(response.status).toBe(409);
      expect(body.expected).toEqual([9000]);
      expect(body.actual).toEqual([3000, 5173, 4321, 8000]);
    });

    test("setup commands run on first launch and are skipped on second", async () => {
      const { POST } = await routeModulePromise;
      seedDeclaredConfig({
        setup: ["echo setup"],
        dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
      });

      let setupRunCount = 0;
      configSetupCommands.set("echo setup", () => {
        setupRunCount += 1;
        return successResult();
      });

      const first = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      expect(first.status).toBe(200);
      expect(setupRunCount).toBe(1);

      const second = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      expect(second.status).toBe(200);
      expect(setupRunCount).toBe(1);
    });

    test("setup failure aborts the launch and does not write the marker", async () => {
      const { POST } = await routeModulePromise;
      seedDeclaredConfig({
        setup: ["bun install"],
        dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
      });
      configSetupCommands.set("bun install", () =>
        failureResult("bun: command not found"),
      );

      const response = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        error: string;
        failed: { command: string; stderr: string };
      };

      expect(response.status).toBe(500);
      expect(body.error).toBe("Setup failed");
      expect(body.failed.command).toBe("bun install");
      expect(detachedLaunches).toHaveLength(0);
      expect(
        existingPaths.has("/vercel/sandbox/.open-agents/.setup-done"),
      ).toBe(false);
    });

    test("GET reports running declared processes with the primary URL", async () => {
      const { GET, POST } = await routeModulePromise;
      currentSessionRecord.sandboxState.ports = [5173, 3001];
      seedDeclaredConfig({
        dev: [
          { name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" },
          { name: "api", run: "bun run api", port: 3001, cwd: "apps/api" },
        ],
      });

      const launch = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      expect(launch.status).toBe(200);

      const detachedBefore = detachedLaunches.length;

      const response = await GET(
        new Request("http://localhost/api/sessions/session-1/dev-server"),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        mode: string;
        status: string;
        processes: Array<{ name: string; running: boolean; url?: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.mode).toBe("declared");
      expect(body.status).toBe("ready");
      expect(body.processes).toHaveLength(2);
      expect(body.processes[0]?.running).toBe(true);
      expect(body.processes[0]?.url).toBe("https://sb-5173.vercel.run");
      expect(body.processes[1]?.running).toBe(true);
      expect(body.processes[1]?.url).toBeUndefined();
      // GET must never launch.
      expect(detachedLaunches.length).toBe(detachedBefore);
    });

    test("GET reports stopped when no declared processes are running", async () => {
      const { GET } = await routeModulePromise;
      seedDeclaredConfig({
        dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
      });

      const response = await GET(
        new Request("http://localhost/api/sessions/session-1/dev-server"),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        mode: string;
        status: string;
        processes: Array<{ running: boolean; url?: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.mode).toBe("declared");
      expect(body.status).toBe("stopped");
      expect(body.processes[0]?.running).toBe(false);
      expect(body.processes[0]?.url).toBeUndefined();
      expect(detachedLaunches).toHaveLength(0);
    });

    test("GET reports starting when only some declared processes are running", async () => {
      const { GET } = await routeModulePromise;
      seedDeclaredConfig({
        dev: [
          { name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" },
          { name: "api", run: "bun run api", port: 3001, cwd: "apps/api" },
        ],
      });
      // Pretend "web" is running but "api" hasn't come up yet.
      setMockDirectory("/vercel/sandbox/.open-agents/.pids");
      setMockFile("/vercel/sandbox/.open-agents/.pids/web.pid", "10001");
      runningPids.add("10001");

      const response = await GET(
        new Request("http://localhost/api/sessions/session-1/dev-server"),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        mode: string;
        status: string;
        processes: Array<{ name: string; running: boolean; url?: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.status).toBe("starting");
      expect(body.processes[0]?.running).toBe(true);
      // The primary URL is exposed once the first process is up, even if
      // siblings are still coming up — the UI shows partial readiness.
      expect(body.processes[0]?.url).toBe("https://sb-5173.vercel.run");
      expect(body.processes[1]?.running).toBe(false);
      expect(body.processes[1]?.url).toBeUndefined();
    });

    test("DELETE stops all .pid files and tolerates dead pids", async () => {
      const { DELETE, POST } = await routeModulePromise;
      currentSessionRecord.sandboxState.ports = [5173, 3001];
      seedDeclaredConfig({
        dev: [
          { name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" },
          { name: "api", run: "bun run api", port: 3001, cwd: "apps/api" },
        ],
      });

      const launch = await POST(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "POST",
        }),
        createRouteContext(),
      );
      expect(launch.status).toBe(200);

      // Force one of the pids to look dead.
      runningPids.delete("10001");

      const response = await DELETE(
        new Request("http://localhost/api/sessions/session-1/dev-server", {
          method: "DELETE",
        }),
        createRouteContext(),
      );
      const body = (await response.json()) as {
        mode: string;
        stopped: { name: string; pid: string | null }[];
      };

      expect(response.status).toBe(200);
      expect(body.mode).toBe("declared");
      expect(body.stopped.map((s) => s.name).sort()).toEqual(["api", "web"]);
      expect(
        existingPaths.has("/vercel/sandbox/.open-agents/.pids/web.pid"),
      ).toBe(false);
      expect(
        existingPaths.has("/vercel/sandbox/.open-agents/.pids/api.pid"),
      ).toBe(false);
    });
  });
});
