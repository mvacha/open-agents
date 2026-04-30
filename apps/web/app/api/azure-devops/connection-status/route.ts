import { getAdoConnectionStatus } from "@/lib/azure-devops/connection-status";
import { getServerSession } from "@/lib/session/get-server-session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const bypassCache =
    new URL(req.url).searchParams.get("fresh") === "1";
  const status = await getAdoConnectionStatus({ bypassCache });
  return Response.json(status);
}
