# `.open-agents/config.json` — project-declared sandbox setup & dev processes

**Status:** Implemented (with deltas — see § 13)
**Date:** 2026-04-27
**Owner:** Michal Vácha

## 1. Problem

Today, when a user clicks "Start dev server", the route at `apps/web/app/api/sessions/[sessionId]/dev-server/route.ts` heuristically scans the cloned repo for the most plausible dev script and runs it via the package manager implied by the lockfile. That works for trivial projects but fails or guesses wrong for:

- Projects whose package manager isn't on PATH in the sandbox runtime (e.g. `bun.lock` → `bun: command not found`; same trap awaits pnpm/yarn).
- Monorepos with multiple dev servers (frontend + API).
- Projects needing setup steps before dev can run (DB migrations, env priming, codegen).
- Projects that bind ports outside the four currently exposed by the sandbox (`3000/5173/4321/8000`).

This spec introduces a project-declared config file that the user can author to take full control of sandbox setup and dev orchestration. The current heuristic remains as the fallback for projects without a config.

## 2. Goals

- Project authors declare what to install and what processes to run, in one file checked into the repo.
- Multi-process dev servers work end-to-end (start, stop, status).
- Sandbox exposes exactly the ports the project declares; arbitrary port numbers are accepted.
- Errors during launch are atomic and visible (no half-started state, no silent failures).
- Zero-config projects keep working via the existing heuristic.

## 3. Non-goals

- Restart-individual-process endpoint. `DELETE` followed by `POST` is the documented restart path.
- Per-process log streaming.
- Watch-mode auto-restart on file change.
- Per-process env injection beyond what the sandbox already provides.
- Picker UI for selecting which dev processes to start (all are launched together).
- Auto-recreating the sandbox when declared ports drift from the running sandbox's exposed ports.

## 4. The config file

### 4.1 Location & format

`/<repo-root>/.open-agents/config.json`. JSON only; no JS/TS, no remote loading.

### 4.2 Schema (Zod)

```ts
const devProcessSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/i),
  run: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  cwd: z.string().default(".").refine(isSafeRelativePath),
});

const openAgentsConfigSchema = z.object({
  setup: z.array(z.string().min(1)).optional(),
  dev: z.array(devProcessSchema).min(1),
})
  .refine(c => unique(c.dev.map(p => p.name)), "duplicate process names")
  .refine(c => unique(c.dev.map(p => p.port)), "duplicate ports");
```

`isSafeRelativePath`: relative POSIX path that, when resolved against the working directory, doesn't escape it (`..`, absolute paths, drive letters all rejected).

### 4.3 Example

```json
{
  "setup": [
    "bun install",
    "bun run db:migrate"
  ],
  "dev": [
    { "name": "web", "run": "bun run dev", "port": 5173, "cwd": "apps/web" },
    { "name": "api", "run": "bun run api:dev", "port": 3001, "cwd": "apps/api" }
  ]
}
```

### 4.4 Filesystem siblings (runtime, not checked in)

```
.open-agents/
├── config.json          # user-authored
├── .setup-done          # contains setupHash; managed by route
└── .pids/
    └── <name>.pid       # one per running dev process
```

The schema description recommends adding `.open-agents/.setup-done` and `.open-agents/.pids/` to the project's `.gitignore`. Not enforced by the route.

## 5. Architecture

### 5.1 Two paths through the dev-server route

```
POST /api/sessions/:id/dev-server
  └─ read .open-agents/config.json from sandbox
       ├─ present + valid     → declared path  (§ 5.3)
       ├─ present + invalid   → 422 with Zod error joined into body
       ├─ present + IO error  → 500
       └─ absent              → fallback to heuristic (today's code, unchanged) (§ 5.4)
```

Reading config.json from inside the sandbox via `sandbox.readFile` happens on every Start; no in-memory cache. A 300ms read is a worthwhile cost for the guarantee that user edits land immediately.

### 5.2 Sandbox creation: pre-fetching config to set exposed ports

Today, `apps/web/app/api/sandbox/route.ts` calls `connectSandbox({...options, ports: DEFAULT_SANDBOX_PORTS, ...})`. We extend the create path so that when a `repoUrl` is provided:

1. **Pre-fetch** `.open-agents/config.json` from the git provider via a new `GitProvider.fetchRepoFile()` method (§ 6). On any thrown error (network failure, auth failure, anything but a clean 404), log a warning and proceed with default ports — sandbox creation must not be blocked by transient git provider problems.
2. **Parse & validate** with the same Zod schema. On parse failure, log a warning and proceed with default ports; the dev-server route will surface the validation error when the user clicks Start.
3. **If valid and `dev` is present**, pass `ports: unique(config.dev.map(p => p.port))` to `connectSandbox`. Otherwise pass `DEFAULT_SANDBOX_PORTS`.
4. **Persist the resolved port list** on the sandbox state by extending `VercelState` with `ports?: number[]`. The dev-server route reads this at launch time to verify declared ports remain in sync (§ 5.3).

The pre-fetched config is *not* persisted or reused at dev-server-launch time. The route always re-reads from inside the sandbox.

### 5.3 Declared-path launch sequence

```
1. Parse config (Zod).
2. mkdir -p .open-agents/.pids   (idempotent)
3. Verify exposed ports against persisted sandbox state:
     declaredPorts ⊆ (sandboxState.ports ?? DEFAULT_SANDBOX_PORTS)
     ──no──→ 409 "Sandbox ports out of sync. Reset the sandbox to apply."
   (For sandboxes created before this change, `sandboxState.ports` is undefined and we treat it as `DEFAULT_SANDBOX_PORTS`.)
4. Run setup (§ 5.5).
5. For each dev[] entry, **sequentially in declaration order**:
     a. If .open-agents/.pids/<name>.pid exists and `kill -0 $pid` succeeds, skip.
     b. Otherwise build launch command:
          printf '%s' "$$" > .open-agents/.pids/<name>.pid && exec bash -c "<run>"
        run via sandbox.execDetached at <workingDirectory>/<cwd>.
     c. If the launch handshake fails (1.5s probe), immediately stop iteration,
        SIGTERM every sibling launched earlier in this batch, remove their
        pidfiles, and return 500 with { error, failed: { name, exitCode, stderr } }.
6. After all entries have launched, return 200 with { processes: [...] }.
```

### 5.4 Heuristic-path launch sequence (unchanged)

The current code path in `dev-server/route.ts`. Returns the existing single-process response shape `{ packagePath, port, url, mode? }` for backward compatibility with `useDevServer`.

### 5.5 Setup execution

All paths in this section are relative to `workingDirectory` (`/vercel/sandbox`).

```
setupHash = sha256(stableStringify(config.setup ?? []))
markerPath = .open-agents/.setup-done

if read(markerPath) === setupHash: skip.
else:
  for cmd of (config.setup ?? []):
    result = sandbox.exec(cmd, workingDirectory, SETUP_TIMEOUT_MS)
    if result.exitCode !== 0:
      return 500 { error: "Setup failed", failed: { command: cmd, exitCode, stderr } }
  write(markerPath, setupHash)
```

`stableStringify` canonicalizes JSON (sorted keys, no insignificant whitespace) so cosmetic edits to `config.json` don't trigger a re-run. `setup` runs in `workingDirectory` only; per-cwd setup belongs in the user's commands (`(cd apps/api && bun install)`). `SETUP_TIMEOUT_MS` defaults to 10 minutes per command (configurable later if needed).

Setup logs flow through the existing `[VercelSandbox.exec]` console-log instrumentation — the user sees every step's stdout and exit code in the dev server console.

### 5.6 Stop semantics

`DELETE /api/sessions/:id/dev-server`:

```
glob .open-agents/.pids/*.pid
for each pidfile:
  pid = read(pidfile)
  kill TERM (best-effort, ignore failures)
  rm pidfile
return { stopped: [{ name, pid }] }
```

Best-effort: stopping a half-dead process should still succeed. Different bar than start (which is atomic).

## 6. `GitProvider.fetchRepoFile`

Added to the existing `GitProvider` interface in `apps/web/lib/git-providers/types.ts`:

```ts
fetchRepoFile(args: {
  ref: RepoRef;
  branch: string;
  path: string;          // POSIX path inside the repo, e.g. ".open-agents/config.json"
  token: string;
}): Promise<string | null>;
```

Returns the file contents as a UTF-8 string, or `null` if the file doesn't exist (404). All other failures throw.

### 6.1 GitHub implementation

`GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` with `Authorization: Bearer {token}`. Decode the base64 `content` field. 404 → null.

### 6.2 Azure DevOps implementation

`GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path={path}&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&api-version=7.1` with `Authorization: Basic base64(":{pat}")`. Returns the file as the response body. 404 → null.

## 7. Response contract

### 7.1 Declared path, success

```json
{
  "mode": "declared",
  "processes": [
    { "name": "web", "cwd": "apps/web", "port": 5173, "url": "https://...-5173..." },
    { "name": "api", "cwd": "apps/api", "port": 3001 }
  ]
}
```

Only the **first** process in declaration order receives a `url` field — that is the primary, user-facing dev server (rendered in the preview iframe). Subsequent processes (APIs, queues, workers) are launched and their port/cwd are reported, but no `url` is emitted because they are not the surfaced preview. If a project needs every process to be reachable externally, the user should declare them in port order and rely on `sandbox.domain(port)` directly; the convention here is "first process = preview".

### 7.2 Declared path, atomic launch failure

```json
{
  "error": "Process \"api\" failed to start",
  "failed": { "name": "api", "exitCode": 127, "stderr": "bun: command not found" }
}
```

### 7.3 Declared path, ports out of sync

```json
{
  "error": "Sandbox ports out of sync with config.json. Reset the sandbox to apply.",
  "expected": [5173, 3001],
  "actual": [3000, 5173, 4321, 8000]
}
```

### 7.4 Heuristic path (unchanged)

```json
{
  "packagePath": "apps/web",
  "port": 5173,
  "url": "https://...",
  "mode": "heuristic"
}
```

The `mode` discriminator is added to both shapes to let the client narrow safely.

## 8. Client (`useDevServer`)

The hook in `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-dev-server.ts` learns the new shape and narrows on `mode`:

- `mode: "heuristic"` → behaves as today.
- `mode: "declared"` → render `processes[0].url` in the existing single-server slot. The remaining processes are running in the background but are not surfaced in this spec; a multi-process panel is a follow-up.

## 9. Errors & instrumentation

- Every `sandbox.exec` and `sandbox.execDetached` call already logs via the prior `command-logger.ts` work (cwd, exit code, stdout, stderr, duration).
- Setup failures log + bubble up with the failing command and stderr in the response body.
- Atomic launch rollback logs each SIGTERM. On rollback, the response identifies the failing process; sibling cleanup is silent in the response (logs are visible server-side).

## 10. Testing

### 10.1 Schema unit tests
- Valid configs, every Zod error path: missing `dev`, empty `dev`, duplicate `name`, duplicate `port`, port < 1 / > 65535, non-string `run`, `cwd` containing `..`, absolute `cwd`.
- `stableStringify`: same hash for `{a:1,b:2}` vs `{b:2,a:1}` vs whitespace variations; different hash on real change.

### 10.2 `fetchRepoFile` unit tests
- GitHub: 200 + base64 decode, 404 → null, non-200/404 → throw.
- Azure DevOps: 200 plain body, 404 → null, non-200/404 → throw.

### 10.3 Route integration tests
- **Declared path, success:** 1 process, N processes; assert sequential launch order; assert only `processes[0]` has `url`; assert pidfiles created; assert response shape.
- **Declared path, atomic failure:** mock the second `execDetached` to fail; assert the first sibling was SIGTERM'd; assert the third process was never launched; assert pidfiles cleaned; assert 500 body.
- **Declared path, invalid config:** 422 with Zod messages.
- **Declared path, ports out of sync:** 409.
- **Heuristic fallback:** config absent; existing tests must keep passing.
- **Setup hashing:** first launch runs setup and writes marker; second launch with same config skips; config edit re-runs; setup failure aborts launch and does not write marker.
- **Stop:** stops all `.pids/*.pid`; tolerates dead PIDs.

### 10.4 Sandbox-creation tests
- `repoUrl` provided + valid config → ports passed through to `connectSandbox`; `sandboxState.ports` persisted.
- `repoUrl` provided + missing config → `DEFAULT_SANDBOX_PORTS` used.
- `repoUrl` provided + invalid config → fall through to defaults; no failure at sandbox creation.
- `repoUrl` provided + `fetchRepoFile` throws (network/auth) → fall through to defaults; sandbox creation succeeds.

## 11. Migration & rollout

- This is a strictly additive feature: no existing behavior changes for projects without a config.
- New `GitProvider.fetchRepoFile` method must be implemented in both providers before the sandbox-creation pre-fetch lights up; the implementation can be staged: ship `fetchRepoFile` first (covered by unit tests), then enable the pre-fetch in the create route.

## 12. Files touched (estimate)

```
apps/web/lib/git-providers/types.ts                   (+1 method on GitProvider)
apps/web/lib/git-providers/github-provider.ts         (+fetchRepoFile)
apps/web/lib/git-providers/azure-devops-provider.ts   (+fetchRepoFile)
apps/web/lib/open-agents-config/schema.ts             (NEW: Zod + types)
apps/web/lib/open-agents-config/fetch.ts              (NEW: pre-fetch helper)
apps/web/lib/open-agents-config/setup-hash.ts         (NEW: stableStringify + sha256)
apps/web/app/api/sandbox/route.ts                     (pre-fetch + ports override)
packages/sandbox/vercel/state.ts                      (+ports?: number[])
apps/web/app/api/sessions/[sessionId]/dev-server/route.ts
                                                      (declared path + setup + atomic launch)
apps/web/app/api/sessions/[sessionId]/dev-server/route.test.ts
                                                      (extend)
apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-dev-server.ts
                                                      (mode discriminator)
+ tests for each new module
```

## 13. Implementation deltas (post-draft)

The spec above was written before implementation. The shipped feature follows the
same shape; this section records intentional divergences and bundled cleanups so
future readers don't have to reconstruct them from git history.

### 13.1 Sequential launch + primary-only URL (§ 5.3, § 7.1)

The original draft hand-waved on whether multi-process launches were parallel.
The shipped behavior is **strictly sequential** in declaration order, with
**immediate rollback** on the first failing process — no `Promise.allSettled`,
no half-started state. The first process in declaration order is the *only* one
that gets a `url` field; siblings are launched as background services and
their `url` is omitted (the first process is the surfaced preview).

### 13.2 `setup` hash now also covers `env` (§ 5.5)

`computeSetupHash(setup)` became `computeSetupHash({ setup, env })`. Without
this, edits to `config.env` between launches would leave the previous
`.setup-done` marker in place and skip setup, even though the environment
visible to setup commands had changed. Encoded as a stable JSON over both
fields so cosmetic edits remain idempotent.

### 13.3 `connectSandboxForSession` wrapper (new, not in § 12)

Bundled with this work because the declared path needs the sandbox-logs panel
(see § 13.4) and that requires every session-scoped sandbox connection to
wire the `onLog` hook. Lives at `apps/web/lib/sandbox/connect.ts`. All
callers under `apps/web/app/**` and `apps/web/lib/sandbox/**` use the wrapper;
the only legitimate direct callers of `connectSandbox` are the wrapper itself
and the no-session fallback in `chat-post-finish.ts`. Enforced via
`no-restricted-imports` in `.oxlintrc.json` (overrides for `apps/web/**`).

### 13.4 Sandbox-logs panel & supporting routes (new, not in § 12)

The declared-path UX needs a way to see setup output and per-process command
logs. Implementation:

- `apps/web/lib/sandbox/log-buffer.ts` — in-memory per-session ring buffer
  (cap 2000 entries) plus listener fan-out, persisted on `globalThis` to
  survive Next.js HMR.
- `apps/web/app/api/sessions/[sessionId]/sandbox-logs/stream/route.ts` —
  SSE stream of buffer snapshot + live entries.
- `apps/web/app/api/sessions/[sessionId]/sandbox-logs/route.ts` — DELETE to
  clear the buffer.
- `apps/web/app/api/sessions/[sessionId]/sandbox-exec/route.ts` — POST a
  short-lived bash command for ad-hoc terminal use; output flows back through
  the same log buffer.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-logs-panel.tsx` —
  the UI surface (filter / agent vs git toggle / run command / clear).

The agent itself wires `onLog` with `source: "agent"` so panel filters can
distinguish agent commands from infra ones.

### 13.5 `command-logger.ts` removed; sandbox calls `onLog` directly

The original draft (§ 9) referenced a separate `packages/sandbox/vercel/command-logger.ts`
helper. It was removed during cleanup: each `VercelSandbox.exec` /
`execDetached` site now invokes `this.hooks?.onLog?.(...)` inline. Hook
implementations are documented as "must not throw" — exec calls them
synchronously without wrapping.

### 13.6 Sandbox-creation surfaces config errors

When `.open-agents/config.json` parses but fails Zod validation (or the git
provider returns a transport error), sandbox creation falls back to default
ports as in § 5.2 *and* now returns `configWarning: { kind, error }` in the
response body so the UI can prompt the user to fix the config rather than
silently arriving at a sandbox that the dev-server route will reject with 422.

### 13.7 `stopDeclaredProcesses` uses `sandbox.readdir`

Original draft (§ 5.6) implied `glob .open-agents/.pids/*.pid`. Shipped
implementation uses `sandbox.readdir(.pids, { withFileTypes: true })` —
no extra `ls` round-trip, returns gracefully on a missing directory.

### 13.8 Files actually touched

```
apps/web/lib/git-providers/types.ts                   (+fetchRepoFile)
apps/web/lib/git-providers/github-provider.ts         (+fetchRepoFile)
apps/web/lib/git-providers/azure-devops-provider.ts   (+fetchRepoFile)
apps/web/lib/azure-devops/fetch-repo-file.ts          (NEW)
apps/web/lib/github/api.ts                            (+fetchGitHubRepoFile)
apps/web/lib/open-agents-config/schema.ts             (NEW)
apps/web/lib/open-agents-config/fetch.ts              (NEW)
apps/web/lib/open-agents-config/sandbox-config.ts     (NEW)
apps/web/lib/open-agents-config/sandbox-paths.ts      (NEW)
apps/web/lib/open-agents-config/setup.ts              (NEW)
apps/web/lib/open-agents-config/setup-hash.ts         (NEW; covers env)
apps/web/lib/open-agents-config/processes.ts          (NEW)
apps/web/lib/sandbox/connect.ts                       (NEW: wrapper)
apps/web/lib/sandbox/log-buffer.ts                    (NEW)
apps/web/app/api/sandbox/route.ts                     (pre-fetch + configWarning)
apps/web/app/api/sessions/[sessionId]/dev-server/route.ts  (declared path)
apps/web/app/api/sessions/[sessionId]/sandbox-logs/route.ts             (NEW)
apps/web/app/api/sessions/[sessionId]/sandbox-logs/stream/route.ts      (NEW)
apps/web/app/api/sessions/[sessionId]/sandbox-exec/route.ts             (NEW)
apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-logs-panel.tsx (NEW)
packages/sandbox/vercel/state.ts                      (+ports?)
packages/sandbox/interface.ts                         (+SandboxLogEntry, onLog)
packages/sandbox/vercel/sandbox.ts                    (inline onLog calls)
packages/sandbox/vercel/command-logger.ts             (DELETED in cleanup)
.oxlintrc.json                                        (+no-restricted-imports)
+ tests for each new module
```
