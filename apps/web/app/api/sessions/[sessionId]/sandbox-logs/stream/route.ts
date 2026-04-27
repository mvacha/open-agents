import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { getSandboxLogs, subscribeSandboxLogs } from "@/lib/sandbox/log-buffer";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: RouteContext) {
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      send("snapshot", getSandboxLogs(sessionId));

      const unsubscribe = subscribeSandboxLogs(sessionId, (entry) => {
        send("log", entry);
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // controller may already be closed
        }
      };

      _req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
