import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import {
  getProviderForSession,
  sessionToRepoRef,
} from "@/lib/git-providers/resolve";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type ClosePullRequestResponse = {
  closed: boolean;
  prNumber: number;
};

export async function POST(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  const ref = sessionToRepoRef(sessionRecord);
  if (!ref) {
    return Response.json(
      { error: "Session is not linked to a repository" },
      { status: 400 },
    );
  }

  if (!sessionRecord.prNumber) {
    return Response.json(
      { error: "No pull request found for this session" },
      { status: 400 },
    );
  }

  if (sessionRecord.prStatus === "merged") {
    return Response.json(
      { error: "Pull request is already merged" },
      { status: 409 },
    );
  }

  if (sessionRecord.prStatus === "closed") {
    return Response.json({
      closed: true,
      prNumber: sessionRecord.prNumber,
    } satisfies ClosePullRequestResponse);
  }

  const provider = getProviderForSession(sessionRecord);
  const token = await provider.getCloneToken(authResult.userId);
  if (!token) {
    return Response.json(
      { error: "No token available for this repository" },
      { status: 403 },
    );
  }

  const closeResult = await provider.closePullRequest({
    ref,
    prNumber: sessionRecord.prNumber,
    token,
  });

  if (!closeResult.success) {
    return Response.json(
      { error: closeResult.error ?? "Failed to close pull request" },
      { status: closeResult.statusCode ?? 502 },
    );
  }

  await updateSession(sessionRecord.id, {
    prStatus: "closed",
  });

  return Response.json({
    closed: true,
    prNumber: sessionRecord.prNumber,
  } satisfies ClosePullRequestResponse);
}
