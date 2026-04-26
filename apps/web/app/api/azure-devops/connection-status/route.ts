import { getAdoConnectionStatus } from "@/lib/azure-devops/connection-status";
import { getServerSession } from "@/lib/session/get-server-session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const status = await getAdoConnectionStatus();
  return Response.json(status);
}
