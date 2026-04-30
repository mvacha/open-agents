"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useIsMobile } from "@/hooks/use-mobile";

export type GitPanelTab = "diff" | "pr" | "files";
export type ActiveView = "chat" | "diff" | "file";
export type DiffScope = "uncommitted" | "branch";
export type ActivePanel = "git" | "logs" | null;

const ACTIVE_PANEL_STORAGE_KEY = "open-agents:active-panel";

function isActivePanelValue(value: unknown): value is "git" | "logs" {
  return value === "git" || value === "logs";
}

function readInitialActivePanel(): ActivePanel {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(ACTIVE_PANEL_STORAGE_KEY);
    if (raw === null) {
      // First visit: default to logs panel open.
      return "logs";
    }
    if (raw === "null") {
      return null;
    }
    if (isActivePanelValue(raw)) {
      return raw;
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

type GitPanelContextValue = {
  /** Which panel (if any) is currently open. Only one panel may be open at a time. */
  activePanel: ActivePanel;
  setActivePanel: (panel: ActivePanel) => void;

  /** Whether the right git panel is open (derived from activePanel) */
  gitPanelOpen: boolean;
  setGitPanelOpen: (open: boolean) => void;

  /** Whether the sandbox logs panel is open (derived from activePanel) */
  logsPanelOpen: boolean;
  setLogsPanelOpen: (open: boolean) => void;

  /** Active tab within the git panel */
  gitPanelTab: GitPanelTab;
  setGitPanelTab: (tab: GitPanelTab) => void;

  /** Active view in the main content area (chat messages vs diff) */
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  /** Whether the user has explicitly closed the Changes tab */
  changesTabDismissed: boolean;
  setChangesTabDismissed: (dismissed: boolean) => void;

  /** File path to scroll to in the diff tab view */
  focusedDiffFile: string | null;
  setFocusedDiffFile: (file: string | null) => void;
  focusedDiffRequestId: number;

  /** Open the diff tab in the main content area, optionally focused on a file */
  openDiffToFile: (filePath: string) => void;

  /** Diff scope: "uncommitted" = uncommitted only, "branch" = all changes vs base */
  diffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;

  /** Whether there are uncommitted changes that need attention */
  hasActionNeeded: boolean;
  setHasActionNeeded: (needed: boolean) => void;

  /** Number of changed files (for badge display on toggle button) */
  changesCount: number;
  setChangesCount: (count: number) => void;

  /** Whether there are committed (pushed) changes on the branch */
  hasCommittedChanges: boolean;
  setHasCommittedChanges: (has: boolean) => void;

  /** File path currently open in the file tab view */
  focusedFilePath: string | null;
  setFocusedFilePath: (file: string | null) => void;

  /** Whether the user has explicitly closed the File tab */
  fileTabDismissed: boolean;
  setFileTabDismissed: (dismissed: boolean) => void;

  /** Open a file in the main content area (non-diff view) */
  openFileTab: (filePath: string) => void;

  /** Share dialog trigger (set by per-chat page, called by header) */
  shareRequested: boolean;
  setShareRequested: (requested: boolean) => void;

  /** Ref to the DOM node where the active panel should be portaled into */
  panelPortalRef: RefObject<HTMLDivElement | null>;

  /** Ref to the DOM node where header action buttons should be portaled into */
  headerActionsRef: RefObject<HTMLDivElement | null>;
};

const GitPanelContext = createContext<GitPanelContextValue | undefined>(
  undefined,
);

export function GitPanelProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [activePanel, setActivePanelState] = useState<ActivePanel>(
    readInitialActivePanel,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        ACTIVE_PANEL_STORAGE_KEY,
        activePanel === null ? "null" : activePanel,
      );
    } catch {
      // ignore quota errors
    }
  }, [activePanel]);

  const setActivePanel = useCallback((panel: ActivePanel) => {
    setActivePanelState(panel);
  }, []);

  const setGitPanelOpen = useCallback((open: boolean) => {
    setActivePanelState((prev) => {
      if (open) return "git";
      return prev === "git" ? null : prev;
    });
  }, []);

  const setLogsPanelOpen = useCallback((open: boolean) => {
    setActivePanelState((prev) => {
      if (open) return "logs";
      return prev === "logs" ? null : prev;
    });
  }, []);

  const gitPanelOpen = activePanel === "git";
  const logsPanelOpen = activePanel === "logs";

  const [gitPanelTab, setGitPanelTab] = useState<GitPanelTab>("files");
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [focusedDiffFile, setFocusedDiffFile] = useState<string | null>(null);
  const [focusedDiffRequestId, setFocusedDiffRequestId] = useState(0);
  const [changesTabDismissed, setChangesTabDismissed] = useState(false);
  const [diffScope, setDiffScope] = useState<DiffScope>("uncommitted");
  const [hasActionNeeded, setHasActionNeeded] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [hasCommittedChanges, setHasCommittedChanges] = useState(false);
  const [focusedFilePath, setFocusedFilePath] = useState<string | null>(null);
  const [fileTabDismissed, setFileTabDismissed] = useState(false);
  const [shareRequested, setShareRequested] = useState(false);
  const panelPortalRef = useRef<HTMLDivElement | null>(null);
  const headerActionsRef = useRef<HTMLDivElement | null>(null);

  const openDiffToFile = useCallback(
    (filePath: string) => {
      setFocusedDiffFile(filePath);
      setFocusedDiffRequestId((prev) => prev + 1);
      setActiveView("diff");
      setChangesTabDismissed(false);
      if (isMobile) setActivePanelState(null);
    },
    [isMobile],
  );

  const openFileTab = useCallback(
    (filePath: string) => {
      setFocusedFilePath(filePath);
      setActiveView("file");
      setFileTabDismissed(false);
      if (isMobile) setActivePanelState(null);
    },
    [isMobile],
  );

  const value = useMemo(
    () => ({
      activePanel,
      setActivePanel,
      gitPanelOpen,
      setGitPanelOpen,
      logsPanelOpen,
      setLogsPanelOpen,
      gitPanelTab,
      setGitPanelTab,
      activeView,
      setActiveView,
      changesTabDismissed,
      setChangesTabDismissed,
      focusedDiffFile,
      setFocusedDiffFile,
      focusedDiffRequestId,
      openDiffToFile,
      diffScope,
      setDiffScope,
      hasActionNeeded,
      setHasActionNeeded,
      changesCount,
      setChangesCount,
      hasCommittedChanges,
      setHasCommittedChanges,
      focusedFilePath,
      setFocusedFilePath,
      fileTabDismissed,
      setFileTabDismissed,
      openFileTab,
      shareRequested,
      setShareRequested,
      panelPortalRef,
      headerActionsRef,
    }),
    [
      activePanel,
      setActivePanel,
      gitPanelOpen,
      setGitPanelOpen,
      logsPanelOpen,
      setLogsPanelOpen,
      gitPanelTab,
      activeView,
      changesTabDismissed,
      focusedDiffFile,
      focusedDiffRequestId,
      openDiffToFile,
      focusedFilePath,
      fileTabDismissed,
      openFileTab,
      diffScope,
      hasActionNeeded,
      changesCount,
      hasCommittedChanges,
      shareRequested,
    ],
  );

  return (
    <GitPanelContext.Provider value={value}>
      {children}
    </GitPanelContext.Provider>
  );
}

export function useGitPanel() {
  const context = useContext(GitPanelContext);
  if (!context) {
    throw new Error("useGitPanel must be used within a GitPanelProvider");
  }
  return context;
}
