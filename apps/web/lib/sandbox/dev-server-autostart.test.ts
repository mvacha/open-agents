import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type MockEntry = { type: "file" | "directory"; content?: string };

let paths: Map<string, MockEntry>;
let runningPids: Set<string>;
let detachedLaunches: { command: string; cwd: string }[];
let setupCommands: string[];

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

const execMock = mock(async (command: string) => {
  if (command.startsWith("kill -0 ")) {
    const pid = command.slice("kill -0 ".length).trim();
    return runningPids.has(pid) ? successResult() : failureResult("dead");
  }
  if (command.startsWith("rm -f ")) {
    const filePath = command.match(/^rm -f '(.+)'$/)?.[1];
    if (filePath) {
      paths.delete(filePath);
    }
    return successResult();
  }
  setupCommands.push(command);
  return successResult();
});

const readFileMock = mock(async (filePath: string) => {
  const entry = paths.get(filePath);
  if (!entry || entry.type !== "file") {
    throw new Error(`ENOENT: ${filePath}`);
  }
  return entry.content ?? "";
});

const writeFileMock = mock(async (filePath: string, content: string) => {
  paths.set(filePath, { type: "file", content });
});

const accessMock = mock(async (filePath: string) => {
  if (!paths.has(filePath)) {
    throw new Error(`ENOENT: ${filePath}`);
  }
});

const execDetachedMock = mock(async (command: string, cwd: string) => {
  detachedLaunches.push({ command, cwd });
  const pidPath = command.match(/> '([^']+\.pid)'/)?.[1];
  if (pidPath) {
    const pid = `${10000 + detachedLaunches.length}`;
    paths.set(pidPath, { type: "file", content: pid });
    runningPids.add(pid);
  }
  return { commandId: `cmd-${detachedLaunches.length}` };
});

const mkdirMock = mock(async (dirPath: string) => {
  paths.set(dirPath, { type: "directory" });
});

const readdirMock = mock(async () => []);

function makeSandbox() {
  return {
    type: "cloud" as const,
    workingDirectory: "/vercel/sandbox",
    exec: execMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    access: accessMock,
    execDetached: execDetachedMock,
    mkdir: mkdirMock,
    readdir: readdirMock,
    stat: mock(async () => {
      throw new Error("not used");
    }),
    domain: (port: number) => `https://sb-${port}.vercel.run`,
    stop: mock(async () => undefined),
    getState: () => ({ sandboxId: "sandbox-test" }),
  };
}

const autostartModulePromise = import("./dev-server-autostart");

function seedConfig(config: object) {
  paths.set("/vercel/sandbox/.open-agents", { type: "directory" });
  paths.set("/vercel/sandbox/.open-agents/config.json", {
    type: "file",
    content: JSON.stringify(config),
  });
}

async function flushAutostart(
  autostart: typeof import("./dev-server-autostart"),
) {
  // Drain microtasks until the in-flight promise resolves.
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  // Use the testing reset hook to ensure the dedupe map is empty between tests.
  void autostart;
}

describe("maybeAutostartDevServer", () => {
  beforeEach(() => {
    paths = new Map();
    runningPids = new Set();
    detachedLaunches = [];
    setupCommands = [];
    execMock.mockClear();
    readFileMock.mockClear();
    writeFileMock.mockClear();
    accessMock.mockClear();
    execDetachedMock.mockClear();
    mkdirMock.mockClear();
    readdirMock.mockClear();
  });

  test("no-ops when .open-agents/config.json is missing", async () => {
    const autostart = await autostartModulePromise;
    autostart.__testing.reset();

    autostart.maybeAutostartDevServer({
      sandbox: makeSandbox() as never,
      sessionId: "session-missing",
    });
    await flushAutostart(autostart);

    expect(detachedLaunches).toHaveLength(0);
  });

  test("no-ops when autostart is disabled in config", async () => {
    const autostart = await autostartModulePromise;
    autostart.__testing.reset();
    seedConfig({
      autostart: false,
      dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
    });

    autostart.maybeAutostartDevServer({
      sandbox: makeSandbox() as never,
      sessionId: "session-no-auto",
    });
    await flushAutostart(autostart);

    expect(detachedLaunches).toHaveLength(0);
  });

  test("launches declared processes when autostart is enabled and none are running", async () => {
    const autostart = await autostartModulePromise;
    autostart.__testing.reset();
    seedConfig({
      dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
    });

    autostart.maybeAutostartDevServer({
      sandbox: makeSandbox() as never,
      sessionId: "session-launch",
    });
    await flushAutostart(autostart);

    expect(detachedLaunches).toHaveLength(1);
    expect(detachedLaunches[0]?.command).toContain(
      "/vercel/sandbox/.open-agents/.pids/web.pid",
    );
  });

  test("skips launch when all declared processes are already running", async () => {
    const autostart = await autostartModulePromise;
    autostart.__testing.reset();
    seedConfig({
      dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
    });
    paths.set("/vercel/sandbox/.open-agents/.pids", { type: "directory" });
    paths.set("/vercel/sandbox/.open-agents/.pids/web.pid", {
      type: "file",
      content: "42",
    });
    runningPids.add("42");

    autostart.maybeAutostartDevServer({
      sandbox: makeSandbox() as never,
      sessionId: "session-already-up",
    });
    await flushAutostart(autostart);

    expect(detachedLaunches).toHaveLength(0);
  });

  test("dedupes concurrent calls for the same (sessionId, sandbox)", async () => {
    const autostart = await autostartModulePromise;
    autostart.__testing.reset();
    seedConfig({
      dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
    });

    const sandbox = makeSandbox();
    autostart.maybeAutostartDevServer({
      sandbox: sandbox as never,
      sessionId: "session-dedupe",
    });
    autostart.maybeAutostartDevServer({
      sandbox: sandbox as never,
      sessionId: "session-dedupe",
    });
    autostart.maybeAutostartDevServer({
      sandbox: sandbox as never,
      sessionId: "session-dedupe",
    });
    await flushAutostart(autostart);

    expect(detachedLaunches).toHaveLength(1);
  });

  test("runs setup commands once and skips them on the next ready check", async () => {
    const autostart = await autostartModulePromise;
    autostart.__testing.reset();
    seedConfig({
      setup: ["echo hello"],
      dev: [{ name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" }],
    });

    autostart.maybeAutostartDevServer({
      sandbox: makeSandbox() as never,
      sessionId: "session-setup",
    });
    await flushAutostart(autostart);

    expect(setupCommands).toEqual(["echo hello"]);
    expect(detachedLaunches).toHaveLength(1);
  });
});
