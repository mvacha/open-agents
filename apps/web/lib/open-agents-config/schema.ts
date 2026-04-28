import { z } from "zod";

const PROCESS_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

export const OPEN_AGENTS_CONFIG_RELATIVE_PATH = ".open-agents/config.json";

export function isSafeRelativePath(value: string): boolean {
  if (value === "") {
    return false;
  }
  if (value.includes("\0")) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return false;
  }
  if (value.startsWith("/")) {
    return false;
  }
  if (value.startsWith("\\")) {
    return false;
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      return false;
    }
  }
  return true;
}

function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

export const devProcessSchema = z.object({
  name: z.string().min(1).regex(PROCESS_NAME_PATTERN),
  run: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  cwd: z.string().default(".").refine(isSafeRelativePath, {
    message: "cwd must be a safe relative path inside the working directory",
  }),
});

export type DevProcess = z.infer<typeof devProcessSchema>;

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const envRecordSchema = z.record(
  z.string().regex(ENV_NAME_PATTERN, {
    message: "env name must match /^[A-Za-z_][A-Za-z0-9_]*$/",
  }),
  z.string(),
);

export const openAgentsConfigSchema = z
  .object({
    setup: z.array(z.string().min(1)).optional(),
    env: envRecordSchema.optional(),
    dev: z.array(devProcessSchema).min(1),
    autostart: z.boolean().default(true),
  })
  .refine((c) => unique(c.dev.map((p) => p.name)), {
    message: "duplicate process names",
    path: ["dev"],
  })
  .refine((c) => unique(c.dev.map((p) => p.port)), {
    message: "duplicate ports",
    path: ["dev"],
  });

export type OpenAgentsConfig = z.infer<typeof openAgentsConfigSchema>;

export interface OpenAgentsConfigParseSuccess {
  kind: "ok";
  config: OpenAgentsConfig;
}

export interface OpenAgentsConfigParseFailure {
  kind: "invalid";
  error: string;
}

export function parseOpenAgentsConfigFromJson(
  raw: string,
): OpenAgentsConfigParseSuccess | OpenAgentsConfigParseFailure {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      kind: "invalid",
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = openAgentsConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    return {
      kind: "invalid",
      error: result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }

  return { kind: "ok", config: result.data };
}
