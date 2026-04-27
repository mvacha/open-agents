"use client";

import type { SandboxLogEntry } from "@open-harness/sandbox";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  CornerDownLeft,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SandboxLogsPanelProps = {
  sessionId: string;
  hasSandbox: boolean;
};

const COMMAND_HISTORY_LIMIT = 50;
const PREVIEW_LINE_LIMIT = 3;

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const millis = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${millis}`;
}

function isErrorEntry(entry: SandboxLogEntry): boolean {
  return typeof entry.exitCode === "number" && entry.exitCode !== 0;
}

function entryMatchesSearch(entry: SandboxLogEntry, needle: string): boolean {
  if (!needle) return true;
  const lower = needle.toLowerCase();
  if (entry.command.toLowerCase().includes(lower)) return true;
  if (entry.stdout?.toLowerCase().includes(lower)) return true;
  if (entry.stderr?.toLowerCase().includes(lower)) return true;
  return false;
}

const GIT_COMMAND_PATTERN = /^\s*git(\s|$)/;

function isGitEntry(entry: SandboxLogEntry): boolean {
  return GIT_COMMAND_PATTERN.test(entry.command);
}

function isAgentEntry(entry: SandboxLogEntry): boolean {
  return entry.source === "agent";
}

type CollapsibleOutputProps = {
  text: string;
  className?: string;
};

function CollapsibleOutput({ text, className }: CollapsibleOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split("\n"), [text]);
  const overflows = lines.length > PREVIEW_LINE_LIMIT;

  if (!overflows) {
    return <div className={className}>{text}</div>;
  }

  const displayed = expanded
    ? text
    : lines.slice(0, PREVIEW_LINE_LIMIT).join("\n");
  const hiddenCount = lines.length - PREVIEW_LINE_LIMIT;

  return (
    <div className="relative">
      <div className={className}>{displayed}</div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3 w-3" /> collapse
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" /> {hiddenCount} more line
            {hiddenCount === 1 ? "" : "s"}
          </>
        )}
      </button>
    </div>
  );
}

export function SandboxLogsPanel({
  sessionId,
  hasSandbox,
}: SandboxLogsPanelProps) {
  const [entries, setEntries] = useState<SandboxLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showGit, setShowGit] = useState(true);
  const [showAgent, setShowAgent] = useState(true);
  const [commandInput, setCommandInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const commandHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const url = `/api/sessions/${sessionId}/sandbox-logs/stream`;

    let cancelled = false;
    let source: EventSource | null = null;

    try {
      source = new EventSource(url, { withCredentials: true });
    } catch {
      return;
    }

    source.addEventListener("snapshot", (event) => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(
          (event as MessageEvent).data,
        ) as SandboxLogEntry[];
        setEntries(parsed);
      } catch {
        // ignore malformed payload
      }
    });

    source.addEventListener("log", (event) => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(
          (event as MessageEvent).data,
        ) as SandboxLogEntry;
        setEntries((prev) => {
          const next = prev.concat(parsed);
          // Cap client-side too to avoid unbounded growth.
          if (next.length > 4000) {
            next.splice(0, next.length - 4000);
          }
          return next;
        });
      } catch {
        // ignore malformed payload
      }
    });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [sessionId]);

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (!showGit && isGitEntry(entry)) return false;
      if (!showAgent && isAgentEntry(entry)) return false;
      if (search && !entryMatchesSearch(entry, search)) return false;
      return true;
    });
  }, [entries, search, showGit, showAgent]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 16;
  };

  const submitCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      const history = commandHistoryRef.current;
      if (history[history.length - 1] !== trimmed) {
        history.push(trimmed);
        if (history.length > COMMAND_HISTORY_LIMIT) {
          history.shift();
        }
      }
      historyIndexRef.current = null;

      setSubmitError(null);
      setIsSubmitting(true);
      stickToBottomRef.current = true;

      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/sandbox-exec`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: trimmed }),
          },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setSubmitError(data.error ?? `Failed: ${response.status}`);
        } else {
          setCommandInput("");
        }
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsSubmitting(false);
      }
    },
    [sessionId],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    void submitCommand(commandInput);
  };

  const handleClear = useCallback(async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/sandbox-logs`, {
        method: "DELETE",
      });
      if (response.ok) {
        setEntries([]);
      }
    } catch {
      // Silent: clearing is best-effort.
    } finally {
      setIsClearing(false);
    }
  }, [isClearing, sessionId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const history = commandHistoryRef.current;
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      const next =
        historyIndexRef.current === null
          ? history.length - 1
          : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = next;
      setCommandInput(history[next] ?? "");
    } else if (event.key === "ArrowDown" && historyIndexRef.current !== null) {
      event.preventDefault();
      const next = historyIndexRef.current + 1;
      if (next >= history.length) {
        historyIndexRef.current = null;
        setCommandInput("");
      } else {
        historyIndexRef.current = next;
        setCommandInput(history[next] ?? "");
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="flex h-7 flex-1 items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Sandbox logs</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex cursor-pointer select-none items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
              <input
                type="checkbox"
                checked={showAgent}
                onChange={(e) => setShowAgent(e.target.checked)}
                className="h-3 w-3 cursor-pointer accent-foreground"
              />
              agent
            </label>
            <label className="flex cursor-pointer select-none items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
              <input
                type="checkbox"
                checked={showGit}
                onChange={(e) => setShowGit(e.target.checked)}
                className="h-3 w-3 cursor-pointer accent-foreground"
              />
              git
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              title="Clear logs"
              onClick={handleClear}
              disabled={isClearing || entries.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 h-10">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.0 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter logs"
            className="h-7 w-full rounded border border-border bg-transparent pl-7 pr-2 text-xs outline-none focus:border-ring"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0",
            showTimestamps && "bg-accent text-accent-foreground",
          )}
          onClick={() => setShowTimestamps((v) => !v)}
          title="Toggle timestamps"
        >
          <Clock className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-xs"
      >
        {filtered.length === 0 ? (
          <div className="px-1 py-2 text-muted-foreground">
            {entries.length === 0
              ? "No sandbox commands yet."
              : "No logs match the filter."}
          </div>
        ) : (
          filtered.map((entry, idx) => {
            const isError = isErrorEntry(entry);
            const exitPart =
              entry.exitCode === 0 || entry.exitCode === null
                ? null
                : `exit=${entry.exitCode}`;
            return (
              <div key={`${entry.timestamp}-${idx}`} className="break-all py-1">
                <div
                  className={cn(
                    "whitespace-pre-wrap font-medium",
                    isError ? "text-red-500" : "text-foreground",
                  )}
                >
                  {showTimestamps && (
                    <span className="font-normal text-muted-foreground">
                      {formatTimestamp(entry.timestamp)}{" "}
                    </span>
                  )}
                  <span className="font-normal text-muted-foreground">$</span>{" "}
                  <span>{entry.command}</span>
                </div>
                {exitPart && (
                  <div className="mt-0.5 ml-2 border-l border-red-500/40 pl-2">
                    <div className="font-normal text-red-500/90">
                      {exitPart}
                    </div>
                  </div>
                )}
                {entry.stdout ? (
                  <div className="mt-0.5 ml-2 border-l border-border/60 pl-2">
                    <CollapsibleOutput
                      text={entry.stdout}
                      className="whitespace-pre-wrap text-foreground/80"
                    />
                  </div>
                ) : null}
                {entry.stderr ? (
                  <div className="mt-0.5 ml-2 border-l border-red-500/40 pl-2">
                    <CollapsibleOutput
                      text={entry.stderr}
                      className="whitespace-pre-wrap text-red-500/90"
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {hasSandbox ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-1 border-t border-border bg-muted/30 px-2 py-1.5"
        >
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-mono text-xs">$</span>
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Run a bash command in the sandbox"
              disabled={isSubmitting}
              spellCheck={false}
              autoComplete="off"
              className="h-7 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={isSubmitting || commandInput.trim().length === 0}
              className="h-7 w-7 shrink-0"
              title="Run command (Enter)"
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
          {submitError ? (
            <div className="px-2 text-red-500 text-xs">{submitError}</div>
          ) : null}
        </form>
      ) : (
        <div className="border-t border-border bg-muted/30 px-3 py-2 text-center text-muted-foreground text-xs">
          Sandbox not running
        </div>
      )}
    </div>
  );
}
