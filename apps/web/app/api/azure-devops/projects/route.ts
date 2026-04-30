import { getAdoClient } from "@/lib/azure-devops/client";
import { getAzureDevOpsConfig } from "@/lib/azure-devops/config";
import { isAzureDevOpsEnabled } from "@/lib/git-providers/feature-flags";
import { getServerSession } from "@/lib/session/get-server-session";

export const runtime = "nodejs";

export async function GET() {
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
  try {
    const projects = await client.listProjects();
    const config = getAzureDevOpsConfig();
    return Response.json({
      org: config.enabled ? config.org : null,
      projects,
    });
  } catch (error) {
    console.error("[ado] listProjects failed:", error);
    return Response.json({ error: "ado_request_failed" }, { status: 502 });
  }
}
