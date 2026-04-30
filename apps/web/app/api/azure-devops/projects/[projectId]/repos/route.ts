import { getAdoClient } from "@/lib/azure-devops/client";
import { isAzureDevOpsEnabled } from "@/lib/git-providers/feature-flags";
import { getServerSession } from "@/lib/session/get-server-session";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
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
  const { projectId } = await context.params;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.toLowerCase().trim() ?? "";
  try {
    let repos = await client.listRepositories(projectId);
    if (q) {
      repos = repos.filter((r) => r.name.toLowerCase().includes(q));
    }
    return Response.json({ repos });
  } catch (error) {
    console.error("[ado] listRepositories failed:", error);
    return Response.json({ error: "ado_request_failed" }, { status: 502 });
  }
}
