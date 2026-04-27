import type { SandboxLogEntry } from "@open-harness/sandbox";

const MAX_ENTRIES_PER_SESSION = 2000;

type Listener = (entry: SandboxLogEntry) => void;

interface SessionLogState {
  entries: SandboxLogEntry[];
  listeners: Set<Listener>;
}

// Back the buffer with globalThis so writers (route handlers) and readers
// (SSE stream) share state even after Next.js dev-mode HMR re-evaluates
// this module from different paths.
const STATE_GLOBAL_KEY = Symbol.for("open-harness.sandbox-log-buffer");
type GlobalWithBuffer = typeof globalThis & {
  [STATE_GLOBAL_KEY]?: Map<string, SessionLogState>;
};
const globalWithBuffer = globalThis as GlobalWithBuffer;
const state: Map<string, SessionLogState> =
  globalWithBuffer[STATE_GLOBAL_KEY] ?? new Map<string, SessionLogState>();
globalWithBuffer[STATE_GLOBAL_KEY] = state;

function getOrCreate(sessionId: string): SessionLogState {
  let session = state.get(sessionId);
  if (!session) {
    session = { entries: [], listeners: new Set() };
    state.set(sessionId, session);
  }
  return session;
}

export function pushSandboxLog(
  sessionId: string,
  entry: SandboxLogEntry,
): void {
  const session = getOrCreate(sessionId);
  session.entries.push(entry);
  if (session.entries.length > MAX_ENTRIES_PER_SESSION) {
    session.entries.splice(0, session.entries.length - MAX_ENTRIES_PER_SESSION);
  }
  for (const listener of session.listeners) {
    try {
      listener(entry);
    } catch {
      // Listener errors must not block other listeners.
    }
  }
}

export function getSandboxLogs(sessionId: string): SandboxLogEntry[] {
  return state.get(sessionId)?.entries.slice() ?? [];
}

export function clearSandboxLogs(sessionId: string): void {
  const session = state.get(sessionId);
  if (!session) return;
  session.entries.length = 0;
}

export function subscribeSandboxLogs(
  sessionId: string,
  listener: Listener,
): () => void {
  const session = getOrCreate(sessionId);
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

export function makeSandboxLogHook(
  sessionId: string,
  source?: string,
): (entry: SandboxLogEntry) => void {
  return (entry) =>
    pushSandboxLog(sessionId, source ? { ...entry, source } : entry);
}
