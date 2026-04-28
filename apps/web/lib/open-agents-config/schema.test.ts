import { describe, expect, it } from "bun:test";
import {
  isSafeRelativePath,
  openAgentsConfigSchema,
  parseOpenAgentsConfigFromJson,
} from "./schema";

describe("openAgentsConfigSchema", () => {
  const validConfig = {
    setup: ["bun install"],
    dev: [
      { name: "web", run: "bun run dev", port: 5173, cwd: "apps/web" },
      { name: "api", run: "bun run api:dev", port: 3001, cwd: "apps/api" },
    ],
  };

  it("accepts a valid config and defaults cwd to '.'", () => {
    const parsed = openAgentsConfigSchema.parse({
      dev: [{ name: "web", run: "bun run dev", port: 5173 }],
    });
    expect(parsed.dev[0]?.cwd).toBe(".");
  });

  it("accepts a fully-formed config", () => {
    const parsed = openAgentsConfigSchema.parse(validConfig);
    expect(parsed.dev).toHaveLength(2);
  });

  it("defaults autostart to true", () => {
    const parsed = openAgentsConfigSchema.parse({
      dev: [{ name: "web", run: "bun run dev", port: 5173 }],
    });
    expect(parsed.autostart).toBe(true);
  });

  it("respects an explicit autostart value", () => {
    const parsed = openAgentsConfigSchema.parse({
      autostart: false,
      dev: [{ name: "web", run: "bun run dev", port: 5173 }],
    });
    expect(parsed.autostart).toBe(false);
  });

  it("rejects missing dev", () => {
    expect(() => openAgentsConfigSchema.parse({})).toThrow();
  });

  it("rejects empty dev", () => {
    expect(() => openAgentsConfigSchema.parse({ dev: [] })).toThrow();
  });

  it("rejects duplicate names", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [
          { name: "web", run: "x", port: 1 },
          { name: "web", run: "y", port: 2 },
        ],
      }),
    ).toThrow();
  });

  it("rejects duplicate ports", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [
          { name: "a", run: "x", port: 1 },
          { name: "b", run: "y", port: 1 },
        ],
      }),
    ).toThrow();
  });

  it("rejects port out of range", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [{ name: "a", run: "x", port: 0 }],
      }),
    ).toThrow();
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [{ name: "a", run: "x", port: 70000 }],
      }),
    ).toThrow();
  });

  it("rejects non-string run", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [{ name: "a", run: 1, port: 5173 }],
      }),
    ).toThrow();
  });

  it("rejects cwd containing ..", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [{ name: "a", run: "x", port: 5173, cwd: "../escape" }],
      }),
    ).toThrow();
  });

  it("rejects absolute cwd", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [{ name: "a", run: "x", port: 5173, cwd: "/abs" }],
      }),
    ).toThrow();
  });

  it("rejects windows drive letter cwd", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        dev: [{ name: "a", run: "x", port: 5173, cwd: "C:\\foo" }],
      }),
    ).toThrow();
  });

  it("accepts an env record with valid names", () => {
    const parsed = openAgentsConfigSchema.parse({
      env: { NODE_ENV: "development", PORT_OVERRIDE: "5173", _PRIVATE: "x" },
      dev: [{ name: "web", run: "bun run dev", port: 5173 }],
    });
    expect(parsed.env).toEqual({
      NODE_ENV: "development",
      PORT_OVERRIDE: "5173",
      _PRIVATE: "x",
    });
  });

  it("treats env as optional", () => {
    const parsed = openAgentsConfigSchema.parse({
      dev: [{ name: "web", run: "bun run dev", port: 5173 }],
    });
    expect(parsed.env).toBeUndefined();
  });

  it("rejects env names that start with a digit", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        env: { "1FOO": "bar" },
        dev: [{ name: "web", run: "x", port: 5173 }],
      }),
    ).toThrow();
  });

  it("rejects env names with invalid characters", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        env: { "FOO-BAR": "baz" },
        dev: [{ name: "web", run: "x", port: 5173 }],
      }),
    ).toThrow();
  });

  it("rejects non-string env values", () => {
    expect(() =>
      openAgentsConfigSchema.parse({
        env: { FOO: 1 },
        dev: [{ name: "web", run: "x", port: 5173 }],
      }),
    ).toThrow();
  });
});

describe("isSafeRelativePath", () => {
  it("accepts simple relative paths", () => {
    expect(isSafeRelativePath(".")).toBe(true);
    expect(isSafeRelativePath("apps/web")).toBe(true);
    expect(isSafeRelativePath("packages/sandbox")).toBe(true);
  });

  it("rejects empty", () => {
    expect(isSafeRelativePath("")).toBe(false);
  });

  it("rejects absolute and traversal", () => {
    expect(isSafeRelativePath("/abs")).toBe(false);
    expect(isSafeRelativePath("..")).toBe(false);
    expect(isSafeRelativePath("../escape")).toBe(false);
    expect(isSafeRelativePath("apps/../escape")).toBe(false);
  });
});

describe("parseOpenAgentsConfigFromJson", () => {
  it("parses a valid config", () => {
    const result = parseOpenAgentsConfigFromJson(
      JSON.stringify({
        dev: [{ name: "web", run: "bun dev", port: 5173 }],
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.config.dev[0]?.name).toBe("web");
    }
  });

  it("returns failure for invalid JSON", () => {
    const result = parseOpenAgentsConfigFromJson("not json");
    expect(result.kind).toBe("invalid");
  });

  it("returns failure for invalid schema", () => {
    const result = parseOpenAgentsConfigFromJson(JSON.stringify({}));
    expect(result.kind).toBe("invalid");
  });
});
