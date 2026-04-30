import "server-only";
import type { Sandbox } from "@open-harness/sandbox";
import {
  type OpenAgentsConfigParseFailure,
  type OpenAgentsConfigParseSuccess,
  parseOpenAgentsConfigFromJson,
} from "./schema";
import { configPath } from "./sandbox-paths";

export type ReadOpenAgentsConfigResult =
  | { kind: "missing" }
  | OpenAgentsConfigParseSuccess
  | OpenAgentsConfigParseFailure;

/**
 * Read `.open-agents/config.json` from inside the sandbox and return a
 * parsed result. Missing file → `{ kind: "missing" }`. Parse/validation
 * failures → `{ ok: false, error }`. Any other read failure throws so the
 * caller can return 500.
 */
export async function readOpenAgentsConfigFromSandbox(
  sandbox: Pick<Sandbox, "readFile" | "access" | "workingDirectory">,
): Promise<ReadOpenAgentsConfigResult> {
  const filePath = configPath(sandbox.workingDirectory);

  try {
    await sandbox.access(filePath);
  } catch {
    return { kind: "missing" };
  }

  const raw = await sandbox.readFile(filePath, "utf-8");
  return parseOpenAgentsConfigFromJson(raw);
}
