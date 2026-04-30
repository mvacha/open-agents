# State Synchronization Bug Review

Date: 2026-04-29

Focus areas: frontend/backend state, sandbox lifecycle, agent workflow state, Azure DevOps integration, logs, and environment variables.

## Findings

### High: stale stream cleanup can clear a newer active stream

Files:

- `apps/web/app/api/chat/[chatId]/stream/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts`

Both routes read `chat.activeStreamId`, inspect that workflow run, then clear the chat with `updateChatActiveStreamId(chatId, null)`. If a new workflow starts after the stale read but before the cleanup, the cleanup clears the new workflow's stream id. The backend then reports no active stream while the agent is still running.

Use `compareAndSetChatActiveStreamId(chatId, oldRunId, null)` for stale cleanup.

### High: sandbox hibernation can race with a new chat run

Files:

- `apps/web/lib/sandbox/lifecycle.ts`
- `apps/web/app/api/chat/_lib/chat-context.ts`

The lifecycle evaluator marks a session `hibernating`, checks for active streams, connects to the sandbox, checks again, then stops the sandbox. The chat route only checks whether the sandbox state is active; it does not reject sessions in `hibernating`.

A user can submit a prompt after the lifecycle evaluator's second active-stream check but before `sandbox.stop()`. That can start an agent against a sandbox that is being stopped, then the lifecycle update clears runtime sandbox state underneath the chat run.

Add a DB-level lifecycle/version claim around hibernation, or make chat submission reject `hibernating` and retry/reconnect after the lifecycle finishes.

### Medium: new-branch sessions fetch `.open-agents/config.json` from a branch that does not exist yet

Files:

- `apps/web/app/api/sessions/route.ts`
- `apps/web/app/api/sandbox/route.ts`
- `apps/web/app/api/sessions/[sessionId]/dev-server/route.ts`

When `isNewBranch` is true, the session stores a generated branch name. Sandbox creation then prefetches `.open-agents/config.json` from that generated branch through the provider before the sandbox creates the branch. This falls back to default ports/env. Later the dev-server route can read the real config inside the sandbox and reject with "Sandbox ports out of sync with config.json".

Fetch config from the source/default branch when creating a new branch, then persist the ports used to create the sandbox.

### Medium: `useSessions` mixes active-only and all-session data in one SWR cache key

File: `apps/web/hooks/use-sessions.ts`

The hook changes the fetch URL based on `includeArchived`, but always uses `/api/sessions` as the SWR key. Home uses all sessions while the sessions shell uses active-only sessions. These views can overwrite each other's cache, causing archived sessions and counts to appear/disappear incorrectly.

Use the actual endpoint as the SWR key and update mutations to target the matching keys.

### Medium: "last repo" loses provider metadata and rehydrates Azure DevOps repos as GitHub repos

Files:

- `apps/web/lib/db/last-repo.ts`
- `apps/web/components/session-starter.tsx`

`getLastRepoByUserId` returns only `repoOwner` and `repoName`. `SessionStarter` always turns that into a GitHub selection. If the most recent repo session was Azure DevOps, the next starter can build a bogus GitHub repo selection like `https://github.com/{adoOrg}/{repo}`.

Include `repoProvider` and `repoMeta` in last-repo data, or filter last-repo to GitHub until the starter supports provider-aware hydration.

### Medium: repo selector treats unhealthy Azure DevOps as usable

Files:

- `apps/web/lib/azure-devops/connection-status.ts`
- `apps/web/components/repo-selector-compact.tsx`
- `apps/web/app/api/azure-devops/projects/route.ts`

The ADO status endpoint can return `enabled: true, healthy: false`, for example when the feature flag is on but org/PAT are missing. The repo selector treats any enabled ADO response as usable and fetches projects. The projects route then returns 403, leaving the picker in a dead state.

Gate project/repo fetching on `healthy === true` and show the unhealthy reason in the selector/settings UI.

### Medium: `/api/check-pr` is GitHub-only but runs for Azure DevOps sessions

File: `apps/web/app/api/check-pr/route.ts`

The route persists the live sandbox branch, then checks GitHub for an existing PR using `findPullRequestByBranch`. It does not branch on `repoProvider`. For Azure DevOps sessions this can return no PR, fail with a GitHub API error, or clear stale PR metadata after a branch change even though ADO PR state should be provider-owned.

Use `getProviderForSession` and `sessionToRepoRef`, or explicitly no-op/return current provider state for ADO sessions.

### Medium: close-PR route lacks the Azure DevOps gate that merge/readiness already have

File: `apps/web/app/api/sessions/[sessionId]/close-pr/route.ts`

Merge and merge-readiness return a controlled unsupported response for Azure DevOps sessions. Close PR does not. If an ADO session has `prNumber`, this route tries to close it through GitHub using the session clone URL and GitHub token state.

Add the same provider gate used by merge routes, or implement provider-aware PR closing.

### Medium: sandbox terminal/log command execution does not refresh lifecycle activity

Files:

- `apps/web/app/api/sessions/[sessionId]/sandbox-exec/route.ts`
- `apps/web/app/api/sandbox/activity/route.ts`

The logs panel lets users run sandbox commands through `sandbox-exec`, and those commands can take up to 60 seconds. The route connects to the sandbox and executes the command, but it never updates `lastActivityAt`/`hibernateAfter`. A user actively working in the terminal can still have the lifecycle evaluator decide the sandbox is idle and hibernate it.

Refresh lifecycle activity before or after successful command execution. The same audit should be applied to dev-server start/stop routes.

### Medium: Vercel project env selection is saved but not synced into the sandbox

File: `apps/web/app/api/sandbox/route.ts`

Session creation can persist a selected Vercel project, but sandbox creation has Vercel env sync commented out. Users can select/link a Vercel project and still get a sandbox without its development env values, so frontend selection state and sandbox runtime state disagree.

Either remove/disable the project selection UX until env sync is supported, or re-enable a safe env sync path with clear disclosure and filtering.

### Medium: `.open-agents/config.json` env changes are not reconciled for existing/resumed sandboxes

Files:

- `apps/web/app/api/sandbox/route.ts`
- `packages/sandbox/vercel/sandbox.ts`
- `apps/web/lib/open-agents-config/setup.ts`

Config env is passed to sandbox creation, but `getState()` persists only sandbox name, expiry, and ports. Reconnect/resume does not reapply config env. `runSetupCommands` includes env in the setup hash but does not pass env to `sandbox.exec`; it relies on sandbox-level defaults that may be stale or absent.

Persist a config/setup hash and reconcile env on resume, or write config env to a managed dotenv file and source it consistently for setup/dev processes. Avoid hashing env as if it was applied when execution cannot see updated values.

### Low: sandbox logs are in-memory only and disappear across server restarts

Files:

- `apps/web/lib/sandbox/log-buffer.ts`
- `apps/web/app/api/sessions/[sessionId]/sandbox-logs/stream/route.ts`

The log buffer is backed by `globalThis`, capped in memory, and streamed over SSE. This works in a single warm server process, but logs are lost on server restart, serverless instance changes, and multi-instance deployments.

If logs are expected to be durable or shared across instances, persist them to Redis/DB/object storage with retention. If they are best-effort only, label the UI accordingly.

### Low: background dev-server logs only capture launch commands, not process output

Files:

- `packages/sandbox/vercel/sandbox.ts`
- `apps/web/lib/open-agents-config/processes.ts`

`execDetached` logs the launch command and quick failure output. For a long-running dev server, stdout/stderr after the quick probe is not streamed into the sandbox log panel. This can make the UI look like logs are missing even though the process is running.

If live dev-server logs matter, redirect process output to per-process log files and expose those through the logs panel.

