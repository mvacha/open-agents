import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export interface SetupHashInput {
  setup?: readonly string[];
  env?: Record<string, string>;
}

export function computeSetupHash(input: SetupHashInput): string {
  return createHash("sha256")
    .update(
      stableStringify({
        setup: input.setup ?? [],
        env: input.env ?? {},
      }),
    )
    .digest("hex");
}
