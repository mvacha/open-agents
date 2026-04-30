import { getAdoClient } from "@/lib/azure-devops/client";
import { isAzureDevOpsEnabled } from "@/lib/git-providers/feature-flags";
import { getServerSession } from "@/lib/session/get-server-session";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string; repo: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!isAzureDevOpsEnabled()) {
    return Response.json(
      { error: "provider_disabled", provider: "azure_devops" },
      { status: 403 },
    );
  }
  const client = getAdoClient();
  if (!client) {
    return Response.json(
      { error: "provider_disabled", provider: "azure_devops" },
      { status: 403 },
    );
  }

  const { projectId, repo } = await context.params;
  const url = new URL(req.url);
  const query = url.searchParams.get("query")?.trim() || undefined;
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;

  try {
    const result = await client.listBranches({
      project: projectId,
      repo,
      query,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return Response.json(result);
  } catch (error) {
    console.error("[ado] listBranches failed:", error);
    return Response.json({ error: "ado_request_failed" }, { status: 502 });
  }
}
