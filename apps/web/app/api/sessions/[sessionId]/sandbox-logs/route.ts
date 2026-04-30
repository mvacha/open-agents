import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { clearSandboxLogs } from "@/lib/sandbox/log-buffer";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId } = await context.params;
  const owned = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!owned.ok) {
    return owned.response;
  }

  clearSandboxLogs(sessionId);
  return Response.json({ success: true });
}
