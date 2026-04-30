# Architecture

This is a Turborepo monorepo for "Open Harness" - an AI coding agent built with AI SDK.

## Core Flow

```
Web -> Agent (packages/agent) -> Sandbox (packages/sandbox)
```

1. **Web** handles authentication, session management, and the primary user interface
2. **Agent** (`deepAgent`) is a `ToolLoopAgent` with tools for file ops, bash, and task delegation
3. **Sandbox** abstracts file system and shell operations for cloud execution backends

## Key Packages

- **packages/agent/** - Core agent implementation with tools, subagents, and context management
- **packages/sandbox/** - Execution environment abstraction for cloud sandboxes
- **packages/shared/** - Shared utilities across packages

## Subagent Pattern

The `task` tool delegates to specialized subagents:
- **explorer**: Read-only, for codebase research (grep, glob, read, safe bash)
- **executor**: Full access, for implementation tasks (all tools)

## Workspace Structure

```
apps/
  web/           # Web interface
packages/
  agent/         # Core agent logic (@open-harness/agent)
  sandbox/       # Sandbox abstraction (@open-harness/sandbox)
  shared/        # Shared utilities (@open-harness/shared)
  tsconfig/      # Shared TypeScript configs
```

## Git providers

Sessions can target either GitHub or Azure DevOps. The abstraction layer lives at `apps/web/lib/git-providers/`:

- `types.ts` — `GitProvider` interface, `RepoRef`, `RepoMeta` (Zod), `RepoProviderId`
- `resolve.ts` — `getProviderForSession(session)` and `sessionToRepoRef(session)` map a session row to a typed provider + ref
- `github-provider.ts` — wraps `lib/github/*`
- `azure-devops-provider.ts` — wraps `lib/azure-devops/*` (uses `azure-devops-node-api`)
- `feature-flags.ts` — `isGitHubEnabled()` (default true) and `isAzureDevOpsEnabled()` (default false)
- `url-builders.ts` — client-safe URL helpers used by UI components

Orchestration code (`auto-commit-direct`, `auto-pr-direct`, `generate-pr`, merge-readiness) consumes the `GitProvider` interface so it stays provider-agnostic. Concrete provider modules under `lib/github/*` and `lib/azure-devops/*` are not consumed directly by orchestration.

Sessions store the discriminator on the row:
- `repo_provider` — `"github" | "azure_devops"`, `NOT NULL`, default `'github'`
- `repo_meta` — `jsonb`, provider-specific extra fields (currently only `{ provider: "azure_devops", project }`)
