"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DevServerInfo = {
  packagePath: string;
  port: number;
  url: string;
};

export type DevServerLaunchState =
  | { status: "loading" }
  | { status: "idle" }
  | { status: "starting" }
  | { status: "stopping"; info: DevServerInfo }
  | { status: "error"; message: string }
  | { status: "ready"; info: DevServerInfo };

export interface DevServerControls {
  state: DevServerLaunchState;
  menuLabel: string;
  menuDetail: string | null;
  showStopAction: boolean;
  handlePrimaryAction: () => Promise<void>;
  handleStopAction: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body) || typeof body.error !== "string") {
    return fallback;
  }

  return body.error;
}

type StatusProbeResult =
  | { kind: "ready"; info: DevServerInfo }
  | { kind: "starting" }
  | { kind: "stopped" };

function parseStatusResponse(body: unknown): StatusProbeResult | null {
  if (!isRecord(body)) {
    return null;
  }

  const mode = body.mode;
  const status = body.status;

  if (mode === "declared") {
    if (status === "ready") {
      const processes = body.processes;
      if (!Array.isArray(processes) || processes.length === 0) {
        return null;
      }
      const primary = processes[0];
      if (!isRecord(primary)) {
        return null;
      }
      const { name, port, url } = primary;
      if (
        typeof name !== "string" ||
        typeof port !== "number" ||
        !Number.isFinite(port) ||
        typeof url !== "string"
      ) {
        return null;
      }
      return { kind: "ready", info: { packagePath: name, port, url } };
    }
    if (status === "starting") {
      return { kind: "starting" };
    }
    return { kind: "stopped" };
  }

  if (mode !== "heuristic") {
    return null;
  }

  if (status === "ready") {
    const { packagePath, port, url } = body;
    if (
      typeof packagePath !== "string" ||
      typeof port !== "number" ||
      !Number.isFinite(port) ||
      typeof url !== "string"
    ) {
      return null;
    }
    return { kind: "ready", info: { packagePath, port, url } };
  }

  return { kind: "stopped" };
}

function parseLaunchResponse(body: unknown): DevServerInfo | null {
  if (!isRecord(body)) {
    return null;
  }

  const mode = body.mode;

  if (mode === "declared") {
    const processes = body.processes;
    if (!Array.isArray(processes) || processes.length === 0) {
      return null;
    }
    const primary = processes[0];
    if (!isRecord(primary)) {
      return null;
    }
    const { name, port, url } = primary;
    if (
      typeof name !== "string" ||
      typeof port !== "number" ||
      !Number.isFinite(port) ||
      typeof url !== "string"
    ) {
      return null;
    }
    return { packagePath: name, port, url };
  }

  if (mode !== undefined && mode !== "heuristic") {
    return null;
  }

  const { packagePath, port, url } = body;
  if (
    typeof packagePath !== "string" ||
    typeof port !== "number" ||
    !Number.isFinite(port) ||
    typeof url !== "string"
  ) {
    return null;
  }

  return {
    packagePath,
    port,
    url,
  };
}

export function useDevServer({
  sessionId,
  canRun,
}: {
  sessionId: string;
  canRun: boolean;
}): DevServerControls {
  const [state, setState] = useState<DevServerLaunchState>({
    status: "loading",
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!canRun) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "loading" });

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function probe() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/dev-server`);
        if (cancelled) {
          return;
        }
        const body: unknown = await response.json().catch(() => null);

        const current = stateRef.current.status;
        if (
          current === "ready" ||
          current === "stopping" ||
          current === "error"
        ) {
          return;
        }

        if (!response.ok) {
          setState({ status: "idle" });
          return;
        }

        const probeResult = parseStatusResponse(body);
        if (!probeResult) {
          setState({ status: "idle" });
          return;
        }

        if (probeResult.kind === "ready") {
          setState({ status: "ready", info: probeResult.info });
          return;
        }

        if (probeResult.kind === "starting") {
          setState({ status: "starting" });
          timeoutId = setTimeout(() => {
            void probe();
          }, 2000);
          return;
        }

        setState({ status: "idle" });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to probe dev server status:", error);
        setState({ status: "idle" });
      }
    }

    void probe();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [sessionId, canRun]);

  const openDevServerUrl = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (state.status === "ready") {
      openDevServerUrl(state.info.url);
      return;
    }

    if (
      state.status === "starting" ||
      state.status === "stopping" ||
      state.status === "loading"
    ) {
      return;
    }

    setState({ status: "starting" });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/dev-server`, {
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to launch dev server"));
      }

      const launchResponse = parseLaunchResponse(body);
      if (!launchResponse) {
        throw new Error("Invalid dev server response");
      }

      setState({
        status: "ready",
        info: launchResponse,
      });
    } catch (error) {
      console.error("Failed to launch dev server:", error);
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to launch dev server",
      });
    }
  }, [openDevServerUrl, sessionId, state]);

  const handleStopAction = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    setState({ status: "stopping", info: state.info });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/dev-server`, {
        method: "DELETE",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to stop dev server"));
      }

      setState({ status: "idle" });
    } catch (error) {
      console.error("Failed to stop dev server:", error);
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to stop dev server",
      });
    }
  }, [sessionId, state]);

  const menuLabel =
    state.status === "ready"
      ? state.info.packagePath === "root"
        ? "Open Dev Server"
        : `Open ${state.info.packagePath}`
      : state.status === "starting"
        ? "Starting Dev Server..."
        : state.status === "stopping"
          ? "Stopping Dev Server..."
          : state.status === "loading"
            ? "Checking Dev Server..."
            : state.status === "error"
              ? "Retry Dev Server"
              : "Run Dev Server";
  const menuDetail =
    state.status === "ready" || state.status === "stopping"
      ? state.info.url
      : state.status === "error"
        ? state.message
        : null;
  const showStopAction =
    canRun && (state.status === "ready" || state.status === "stopping");

  return {
    state,
    menuLabel,
    menuDetail,
    showStopAction,
    handlePrimaryAction,
    handleStopAction,
  } as const;
}
