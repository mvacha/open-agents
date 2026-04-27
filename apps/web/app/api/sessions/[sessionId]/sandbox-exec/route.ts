import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { connectSandboxForSession } from "@/lib/sandbox/connect";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type ExecRequest = {
  command?: string;
};

const MAX_COMMAND_LENGTH = 4096;
const EXEC_TIMEOUT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(parsedBody)) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body: ExecRequest = parsedBody;
  const command =
    typeof body.command === "string" ? body.command.trim() : undefined;
  if (!command) {
    return Response.json({ error: "command is required" }, { status: 400 });
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return Response.json(
      { error: `command exceeds ${MAX_COMMAND_LENGTH} chars` },
      { status: 400 },
    );
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before running commands",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const sandboxState = sessionContext.sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandboxForSession(sandboxState, sessionId);
    const result = await sandbox.exec(
      command,
      sandbox.workingDirectory,
      EXEC_TIMEOUT_MS,
    );
    return Response.json({
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
