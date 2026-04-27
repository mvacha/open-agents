"use client";

import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  type SessionChatListItem,
  useSessionChats,
} from "@/hooks/use-session-chats";
import type { Session } from "@/lib/db/schema";
import {
  GitPanelProvider,
  useGitPanel,
} from "./chats/[chatId]/git-panel-context";
import { SessionHeader } from "./chats/[chatId]/session-header";
import { ChatTabs } from "./chats/[chatId]/chat-tabs";
import { SessionLayoutContext } from "./session-layout-context";

type SessionLayoutShellProps = {
  session: Session;
  initialChatsData?: {
    defaultModelId: string | null;
    chats: SessionChatListItem[];
  };
  children: ReactNode;
};

const PANEL_WIDTH_STORAGE_KEY = "open-harness:panel-width";
const PANEL_DEFAULT_WIDTH = 288; // matches the previous w-72
const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 720;

function clampPanelWidth(value: number, max: number = PANEL_MAX_WIDTH): number {
  return Math.max(PANEL_MIN_WIDTH, Math.min(max, value));
}

function loadStoredPanelWidth(): number {
  if (typeof window === "undefined") return PANEL_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampPanelWidth(parsed)
    : PANEL_DEFAULT_WIDTH;
}

/**
 * Inner component that reads panelContent from context and renders
 * the horizontal split: left column (header + tabs + page) | right panel.
 */
function SessionLayoutInner({
  activeChatId,
  children,
}: {
  activeChatId: string;
  children: ReactNode;
}) {
  const { panelPortalRef, activePanel, setActivePanel } = useGitPanel();
  const isPanelOpen = activePanel !== null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(PANEL_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setPanelWidth(loadStoredPanelWidth());
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Cap to half the container so the panel can never push the left column
      // to zero width.
      const dynamicMax = Math.max(
        PANEL_MIN_WIDTH,
        Math.floor(rect.width - PANEL_MIN_WIDTH),
      );
      const next = clampPanelWidth(rect.right - event.clientX, dynamicMax);
      setPanelWidth(next);
    };
    const handleUp = () => setIsResizing(false);

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  // Persist width once the user finishes dragging.
  useEffect(() => {
    if (isResizing) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(panelWidth)),
    );
  }, [isResizing, panelWidth]);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative flex h-full overflow-hidden">
      {/* Left column: header + tabs + page content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <SessionHeader />
        {activeChatId && <ChatTabs activeChatId={activeChatId} />}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      {/* Mobile backdrop for outside-click dismissal */}
      {isPanelOpen && (
        <button
          type="button"
          aria-label="Close right sidebar"
          className="absolute inset-0 z-20 bg-background/20 sm:hidden"
          onClick={() => setActivePanel(null)}
        />
      )}

      {/* Portal target for the active panel — slideover on mobile, sidebar on larger screens */}
      <div
        ref={panelPortalRef}
        style={
          isPanelOpen
            ? ({
                "--panel-width": `${panelWidth}px`,
              } as React.CSSProperties)
            : undefined
        }
        className={`absolute right-0 top-0 z-30 flex h-full w-72 flex-col overflow-hidden border-l border-border bg-background shadow-lg ${
          isResizing ? "" : "transition-transform duration-200 ease-in-out"
        } sm:relative sm:right-auto sm:top-auto sm:z-0 sm:shrink-0 sm:translate-x-0 sm:shadow-none ${
          isPanelOpen
            ? "translate-x-0 sm:w-[var(--panel-width)] sm:border-l"
            : "translate-x-full sm:w-0 sm:border-l-0"
        }`}
      >
        {/* Drag handle — only on sm: viewports where the panel is a sidebar. */}
        {isPanelOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onMouseDown={handleResizeStart}
            className="-left-1 absolute top-0 z-10 hidden h-full w-2 cursor-col-resize select-none hover:bg-border/60 sm:block"
          />
        )}
      </div>
    </div>
  );
}

export function SessionLayoutShell({
  session: initialSession,
  initialChatsData,
  children,
}: SessionLayoutShellProps) {
  const router = useRouter();
  const params = useParams<{ chatId?: string }>();
  const routeChatId = params.chatId ?? "";
  const [optimisticActiveChatId, setOptimisticActiveChatId] = useState<
    string | null
  >(null);
  const [_isNavigatingChat, startChatNavigationTransition] = useTransition();
  const prefetchedChatHrefsRef = useRef(new Set<string>());

  const sessionId = initialSession.id;

  const {
    chats,
    loading: chatsLoading,
    createChat,
    deleteChat,
    renameChat,
  } = useSessionChats(sessionId, { initialData: initialChatsData });

  const getChatHref = useCallback(
    (chatId: string) => `/sessions/${sessionId}/chats/${chatId}`,
    [sessionId],
  );

  const switchChat = useCallback(
    (chatId: string) => {
      if (chatId === (optimisticActiveChatId ?? routeChatId)) {
        return;
      }

      const href = getChatHref(chatId);
      prefetchedChatHrefsRef.current.add(href);
      setOptimisticActiveChatId(chatId);
      startChatNavigationTransition(() => {
        router.push(href, { scroll: false });
      });
    },
    [getChatHref, optimisticActiveChatId, routeChatId, router],
  );

  useEffect(() => {
    if (optimisticActiveChatId && optimisticActiveChatId === routeChatId) {
      setOptimisticActiveChatId(null);
    }
  }, [optimisticActiveChatId, routeChatId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const chat of chats.slice(0, 6)) {
        const href = getChatHref(chat.id);
        if (prefetchedChatHrefsRef.current.has(href)) {
          continue;
        }

        prefetchedChatHrefsRef.current.add(href);
        router.prefetch(href);
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
    };
  }, [chats, getChatHref, router]);

  const activeChatId = optimisticActiveChatId ?? routeChatId;

  const layoutContext = useMemo(
    () => ({
      session: {
        title: initialSession.title,
        repoName: initialSession.repoName,
        repoOwner: initialSession.repoOwner,
        cloneUrl: initialSession.cloneUrl,
        branch: initialSession.branch,
        status: initialSession.status,
        prNumber: initialSession.prNumber,
        prStatus: initialSession.prStatus ?? null,
        linesAdded: initialSession.linesAdded,
        linesRemoved: initialSession.linesRemoved,
      },
      chats,
      chatsLoading,
      createChat,
      switchChat,
      deleteChat,
      renameChat,
    }),
    [
      initialSession,
      chats,
      chatsLoading,
      createChat,
      switchChat,
      deleteChat,
      renameChat,
    ],
  );

  return (
    <SessionLayoutContext.Provider value={layoutContext}>
      <GitPanelProvider>
        <SessionLayoutInner activeChatId={activeChatId}>
          {children}
        </SessionLayoutInner>
      </GitPanelProvider>
    </SessionLayoutContext.Provider>
  );
}
