# Azure DevOps Support — Design

**Status:** Draft
**Date:** 2026-04-26
**Goal:** Add Azure DevOps as a second git provider alongside GitHub. Users can create an agent from an Azure DevOps repository and have the agent push commits and open pull requests there, with the same UX as the existing GitHub flow.

## Context

Today the app supports GitHub repos end-to-end:

- Sign-in via GitHub or Vercel
- GitHub App installations for repo access
- Repo picker driven by installation/repo listing
- Auto-commit + auto-push via authenticated remote URL
- Auto-PR via Octokit
- Webhook-driven PR status updates
- Reconnect dialog for invalid/expired tokens

The customer this deployment targets uses Azure DevOps. They need the same end-to-end flow against an Azure DevOps repo. GitHub support is preserved (still useful for verifying functionality), with a future toggle to hide it.

## Configuration model

Azure DevOps is configured per-deployment via environment variables. Single tenant; one Azure DevOps organization, one PAT for the deployment.

| Variable | Purpose | Default |
|---|---|---|
| `AZURE_DEVOPS_ENABLED` | Master switch for the provider | `false` |
| `AZURE_DEVOPS_ORG` | The single org slug (e.g. `contoso` from `dev.azure.com/contoso`) | _unset_ |
| `AZURE_DEVOPS_PAT` | Personal Access Token. Required scopes: **Code (read & write)** and **Code (status)** | _unset_ |
| `GITHUB_ENABLED` | Master switch for the GitHub provider | `true` |

Validation rules:

- If `AZURE_DEVOPS_ENABLED=true` but `AZURE_DEVOPS_ORG` or `AZURE_DEVOPS_PAT` is missing/empty: log a clear error at boot and treat the provider as disabled. Do not crash.
- If both providers are disabled: agent creation surfaces a configuration error rather than an empty picker.
- `GITHUB_ENABLED=false` does **not** delete or break existing GitHub-backed sessions; it disables new-session creation against GitHub and hides GitHub UI surfaces.

The PAT is read at request time from `process.env.AZURE_DEVOPS_PAT`. It is never logged, never persisted in the DB, never sent to the client, and never echoed in API responses. Authenticated remote URLs (which embed the PAT) are written to the sandbox's git config, mirroring how GitHub OAuth tokens are handled today.

## Architecture

We follow a **hybrid abstraction** approach (Approach 3 of the brainstorm):

- Keep `lib/github/*` and add `lib/azure-devops/*` as separate concrete provider modules. The existing GitHub plumbing is not rewritten.
- Introduce a thin `GitProvider` interface used **only** at the orchestration layer (`auto-commit-direct`, `auto-pr-direct`, `generate-pr`, `merge-readiness-polling`).
- Orchestration code becomes provider-agnostic; underlying provider modules stay separate.

### New modules

```
apps/web/lib/azure-devops/
  config.ts                # reads + validates env vars; exposes getAzureDevOpsConfig()
  client.ts                # thin wrapper around azure-devops-node-api
  repo-identifiers.ts      # validation + buildAdoAuthRemoteUrl (URL-encoded)
  connection-status.ts     # health probe via coreApi.getProjects({top:1})

apps/web/lib/git-providers/
  types.ts                 # GitProvider interface, RepoRef + RepoMeta types (Zod)
  resolve.ts               # getProviderForSession(session) -> GitProvider
  github-provider.ts       # wraps existing lib/github/*
  azure-devops-provider.ts # wraps lib/azure-devops/*
```

### SDK choice

We use [`azure-devops-node-api`](https://github.com/microsoft/azure-devops-node-api), Microsoft's official Node SDK. Auth is via `getPersonalAccessTokenHandler(pat)` and `WebApi.getGitApi()` / `getCoreApi()`. The SDK requires the Node.js runtime (not Edge); routes that touch it set `export const runtime = 'nodejs'`. To be verified during implementation; if any Node-only API leaks into a route currently on Edge, that route is moved to Node.

### `GitProvider` interface

```ts
interface GitProvider {
  validateRepoIdentifiers(ref: RepoRef): boolean;
  getCloneToken(userId: string): Promise<string | null>;
  buildAuthRemoteUrl(args: { token: string; ref: RepoRef }): string | null;
  getDefaultBranch(args: { ref: RepoRef; token: string }): Promise<string | null>;
  findPullRequestByBranch(args: {
    ref: RepoRef; branchName: string; token: string;
  }): Promise<PrFindResult>;
  createPullRequest(args: {
    ref: RepoRef; branchName: string; baseBranch: string;
    title: string; body: string; token: string;
  }): Promise<PrCreateResult>;
  getPullRequestStatus(args: {
    ref: RepoRef; prNumber: number; token: string;
  }): Promise<PrStatus>;
  buildPullRequestUrl(ref: RepoRef, prNumber: number): string;
}
```

GitHub `getCloneToken(userId)` returns the user's OAuth token via the existing `getUserGitHubToken`. ADO `getCloneToken` returns the env PAT (no per-user lookup). All other methods take an explicit `token` argument so callers don't depend on provider-specific lookup paths.

## Data model

### Schema changes (`apps/web/lib/db/schema.ts`)

Two additive columns on `sessions`:

| Column | Type | Notes |
|---|---|---|
| `repo_provider` | `text` enum `"github" | "azure_devops"`, **NOT NULL** | Discriminator |
| `repo_meta` | `jsonb` | Provider-specific extra fields; nullable |

### Migration

Generated with `bun run --cwd apps/web db:generate`. Required SQL semantics (Drizzle Kit may collapse to a single statement using `DEFAULT 'github'`; either form is acceptable as long as the end state matches):

```sql
ALTER TABLE sessions ADD COLUMN repo_provider text;
UPDATE sessions SET repo_provider = 'github' WHERE repo_provider IS NULL;
ALTER TABLE sessions ALTER COLUMN repo_provider SET NOT NULL;
ALTER TABLE sessions ADD COLUMN repo_meta jsonb;
```

Per project conventions, this migration is committed alongside the schema change and runs automatically during `bun run build` on every Vercel deploy.

### `RepoMeta` (jsonb shape)

```ts
type RepoMeta =
  | { provider: "github" }                              // reserved; may be null today
  | { provider: "azure_devops"; project: string };      // ADO project name
```

The `provider` discriminator inside the JSON is redundant with the `repo_provider` column; consistency is enforced by a Zod schema in `lib/git-providers/types.ts` on every write. For GitHub sessions, `repo_meta` may be `null` or `{ provider: "github" }` — both are treated equivalently.

### `RepoRef` (in-memory type)

```ts
type RepoRef =
  | { provider: "github"; owner: string; repo: string }
  | { provider: "azure_devops"; org: string; project: string; repo: string };
```

Constructed by a single helper `sessionToRepoRef(session): RepoRef` that reads `repoOwner`, `repoName`, `repoProvider`, `repoMeta` and validates them. **All orchestration code consumes `RepoRef` — never the raw session columns.**

### Field reuse

- `repoOwner` → org slug for ADO sessions (always equal to `AZURE_DEVOPS_ORG` in v1, but stored for forward compatibility with multi-org).
- `repoName` → repository name (both providers).
- `branch`, `cloneUrl` → reused as-is.
- `prNumber` → ADO `pullRequestId` fits as an integer. Note: ADO PR IDs are unique per project, not per repo; this is fine because `prNumber` is always read in conjunction with the session's `RepoRef`.
- `prStatus` → reused (`"open"` | `"merged"` | `"closed"`).

### No new tables

- No `azureDevOpsAccounts` (PAT lives in env, not DB).
- No `azureDevOpsInstallations` (single-org single-PAT).
- The existing `accounts.provider` and `users.provider` enums stay GitHub/Vercel-only — ADO is connection-via-env, not per-user.

## Data flow

### A. Repo selection at agent creation

New API routes (Node runtime):

| Route | Behavior |
|---|---|
| `GET /api/azure-devops/projects` | Lists projects in `AZURE_DEVOPS_ORG` via `coreApi.getProjects()`. 5-minute server-side cache. |
| `GET /api/azure-devops/projects/[projectId]/repos?q=<query>` | Lists repos in the project via `gitApi.getRepositories(projectId)`. Substring filter applied server-side post-fetch. |
| `GET /api/azure-devops/connection-status` | 60-second-cached probe via `coreApi.getProjects({top:1})`. Returns `200` with `{ enabled: false }`, `{ enabled: true, healthy: true }`, or `{ enabled: true, healthy: false, reason }`. **Never 403s** — the UI relies on this endpoint to distinguish "disabled" from "broken." |

The `projects` and `projects/[id]/repos` routes:

- Return `403 Forbidden` with `{ error: "provider_disabled", provider: "azure_devops" }` when `AZURE_DEVOPS_ENABLED !== "true"`.
- Are gated by the existing app session (any logged-in user is permitted; single-tenant assumption).
- Map ADO `401`/`403` responses to `AdoAuthError` with reason `"pat_invalid"` or `"pat_insufficient_scope"`. The orchestration layer surfaces these as `skipReason` in `AutoCreatePrResult`, mirroring the existing GitHub error shape.

UI:

- New `components/azure-devops-repo-picker.tsx` — two-step picker: project select → repo select with search filter.
- Agent-creation page gets a top-level provider selector (tabs or radio) showing only enabled providers (gated by `GITHUB_ENABLED` and `AZURE_DEVOPS_ENABLED`). When only one is enabled the selector is hidden.
- Submit POST to `/api/sessions` carries `provider: "azure_devops"`, `repoOwner` (= org), `repoName`, `repoProject`, `cloneUrl`, `branch`. Server validates `repoOwner === AZURE_DEVOPS_ORG` and that `repoProject` exists in the org's project list.

### B. Cloning and pushing in the sandbox

`auto-commit-direct.ts` is refactored:

1. Resolve `RepoRef` from the session.
2. `provider = getProviderForSession(session)`.
3. `token = await provider.getCloneToken(userId)` (env PAT for ADO; user token for GitHub).
4. `authUrl = provider.buildAuthRemoteUrl({ token, ref })`.
5. `git remote set-url origin "<authUrl>"`, then stage/commit/push as today.

The `git config user.name/user.email` step (commit author = app user) stays unchanged. ADO PRs will surface as authored by the PAT owner — an inherent limitation of the single-PAT model that is accepted in v1.

### C. PR creation

`auto-pr-direct.ts` is refactored to a single provider-agnostic function. The provider's `createPullRequest` for ADO calls `gitApi.createPullRequest({ sourceRefName, targetRefName, title, description, isDraft }, repoId, project)` and returns `{ prNumber: pullRequestId, prUrl }`.

`generatePullRequestContentFromSandbox` (in `lib/git/pr-content.ts`) is already provider-agnostic — kept as-is.

PR URL construction throughout the codebase is replaced with `provider.buildPullRequestUrl(ref, prNumber)` to handle ADO's different URL shape (`https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<id>`).

### D. PR status updates (no webhooks in v1)

ADO Service Hooks would require either programmatic subscription creation per project (a startup task) or manual ops setup. v1 defers this and relies on the existing `merge-readiness-polling` UI loop, which is invoked while a session is open. The polling code calls `provider.getPullRequestStatus(...)` via the abstraction.

The GitHub webhook (`/api/github/webhook`) is unchanged and continues to push events for GitHub-backed sessions only (it is keyed by repo owner/name).

### E. `GITHUB_ENABLED=false` semantics

- Most `/api/github/*` routes (`/installations`, `/installations/repos`, `/app/install`, `/app/callback`) return `403` with `{ error: "provider_disabled", provider: "github" }`.
- `/api/github/connection-status` continues to respond 200, returning `{ enabled: false }` so the UI can distinguish disabled from broken (same shape as the ADO endpoint).
- The agent-creation UI omits GitHub from the provider selector.
- The GitHub webhook (`/api/github/webhook`) **continues to accept events** (logged at WARN) so any in-flight installations don't break; existing GitHub-backed sessions keep working.

## Error handling and edge cases

| Scenario | Handling |
|---|---|
| `AZURE_DEVOPS_PAT` invalid/expired | `AdoAuthError` → orchestration emits `skipReason: "Azure DevOps PAT is invalid or lacks required permissions"`. `connection-status` returns unhealthy. An admin banner appears in agent-creation when ADO is selected and unhealthy. No reconnect dialog (it's an ops problem, not user-fixable). |
| ADO project list call fails | Picker shows a typed error toast; logs at ERROR. |
| PR already exists on `createPullRequest` | SDK throws on duplicate; provider catches and falls through to `findPullRequestByBranch` recovery — same shape as the existing GitHub `"PR already exists or branch not found"` branch. |
| Branch not pushed yet | Existing `auto-pr-direct` precondition checks (`git ls-remote`, head equality) are provider-agnostic and stay. |
| Session repo identifiers fail validation | Returned as `skipReason` matching existing pattern. |
| Both providers disabled | Agent-creation UI shows configuration error (not an empty picker). |
| Both providers enabled and only ADO is healthy | Picker still renders both; user can pick GitHub but their existing GitHub auth remains the gate. |

## Security

- PAT is server-only; never persisted, never returned in any API response.
- `buildAdoAuthRemoteUrl` URL-encodes each path segment (`encodeURIComponent` on org/project/repo). Same defense-in-depth as `buildGitHubAuthRemoteUrl`.
- Branch names continue to be validated against `SAFE_BRANCH_PATTERN` in the orchestration layer.
- Shell composition for `git remote set-url origin "<url>"` uses double quotes; URL encoding ensures no quote characters can escape.
- Org/project values from request bodies are validated against the configured `AZURE_DEVOPS_ORG` and the live project list before being persisted.

## Tests

- `lib/azure-devops/repo-identifiers.test.ts` — URL building, encoding edge cases (spaces, `&`, dots in project names).
- `lib/azure-devops/client.test.ts` — `WebApi`-level mocks for project/repo listing, PR create/find/status.
- `lib/git-providers/resolve.test.ts` — `RepoMeta` Zod validation, dispatch to correct provider.
- Parametrized tests covering both providers for the orchestration layer (`auto-pr-direct`, `auto-commit-direct`).
- A test asserting `GITHUB_ENABLED=false` → `/api/github/installations` returns 403 with the typed body, and the picker omits GitHub.
- A test asserting `AZURE_DEVOPS_ENABLED=false` → `/api/azure-devops/projects` returns 403.

## Scope

### v1 (this spec)

1. Schema migration: `repo_provider` (with backfill) + `repo_meta jsonb`.
2. Env vars: `AZURE_DEVOPS_ENABLED`, `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PAT`, `GITHUB_ENABLED`.
3. `lib/azure-devops/{config,client,repo-identifiers,connection-status}.ts` using `azure-devops-node-api`.
4. `lib/git-providers/{types,resolve,github-provider,azure-devops-provider}.ts`.
5. Refactor of orchestration: `auto-commit-direct.ts`, `auto-pr-direct.ts`, `app/api/generate-pr/*`, `merge-readiness-polling`, all PR URL builders.
6. New API routes: `/api/azure-devops/{projects,projects/[id]/repos,connection-status}`.
7. UI: `azure-devops-repo-picker.tsx` + provider selector on agent creation; provider-aware PR URL/badge in session views.
8. `GITHUB_ENABLED` gating: 403 on disabled GitHub routes (typed body), hidden in picker, webhook continues accepting events.
9. Tests as listed above.
10. Documentation: README section + `docs/agents/architecture.md` update for multi-provider.

### Explicitly out of scope (v1)

- ADO webhooks / Service Hooks (v1 polls).
- ADO sign-in (sign-in stays GitHub/Vercel).
- Multiple ADO orgs (single-org via env).
- Azure DevOps Server (on-prem) — Services only.
- Per-user ADO PATs / per-user ADO commit authorship.
- ADO build/pipeline checks (analogous to GitHub Actions check-runs).
- Removing the `accounts.provider` / `users.provider` enum constraints — both stay GitHub/Vercel-only.

### Future work

- ADO webhook endpoint and programmatic Service Hook subscription on app boot.
- Multi-org ADO config (would require JSON config or DB-stored multi-org records).
- Runtime UI toggle for `GITHUB_ENABLED` (rather than env-only).
- Per-project default-branch caching.

## Rollout

1. **Migration commit.** Land schema migration alone; runs on the next deploy.
2. **No-op refactor commit.** Land `lib/git-providers/*` interface + `GitHubProvider` and refactor orchestration. GitHub-only deployments must continue to pass `bun run ci` end-to-end.
3. **ADO modules + UI commit.** Land `lib/azure-devops/*`, new routes, picker. With `AZURE_DEVOPS_ENABLED=false` (default) these are dormant; existing deployments unaffected.
4. **Customer enablement.** Set `AZURE_DEVOPS_ENABLED=true`, `AZURE_DEVOPS_ORG=<…>`, `AZURE_DEVOPS_PAT=<…>` in the customer's deployment. Verify with one end-to-end run: create agent → make changes → auto-commit → auto-PR.
5. **Optional GitHub disable.** After verification, optionally set `GITHUB_ENABLED=false` for the customer's deployment.

## Open assumptions to verify during implementation

- `azure-devops-node-api` works in the Next.js Node runtime (not Edge). If routes that previously ran on Edge need to call it, they're moved to `runtime = 'nodejs'`.
- Drizzle Kit's generated migration captures the backfill correctly (default-based or explicit). If not, hand-edit the generated SQL.
- ADO project IDs are stable enough to use as URL path segments without re-fetching project metadata mid-session. (Project names can be renamed in ADO; we store both `repo_meta.project` (name) and refresh display from the live project list when needed.)
