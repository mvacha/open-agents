import { describe, expect, it } from "bun:test";
import { computeSetupHash, stableStringify } from "./setup-hash";

describe("stableStringify", () => {
  it("sorts keys", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(
      stableStringify({ b: 2, a: 1 }),
    );
  });

  it("produces identical output regardless of source whitespace", () => {
    expect(stableStringify(JSON.parse('{"a":1,"b":2}'))).toBe(
      stableStringify(JSON.parse('{ "b" : 2,  "a" : 1 }')),
    );
  });

  it("differs on real change", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("recurses into arrays and nested objects", () => {
    expect(stableStringify({ list: [{ b: 1, a: 0 }] })).toBe(
      stableStringify({ list: [{ a: 0, b: 1 }] }),
    );
  });
});

describe("computeSetupHash", () => {
  it("returns the same hash for identical setup arrays", () => {
    expect(
      computeSetupHash({ setup: ["bun install", "bun run db:migrate"] }),
    ).toBe(computeSetupHash({ setup: ["bun install", "bun run db:migrate"] }));
  });

  it("returns the same hash for empty and undefined setup", () => {
    expect(computeSetupHash({ setup: undefined })).toBe(
      computeSetupHash({ setup: [] }),
    );
  });

  it("returns a different hash when commands change", () => {
    expect(computeSetupHash({ setup: ["bun install"] })).not.toBe(
      computeSetupHash({ setup: ["bun install", "bun run db:migrate"] }),
    );
  });

  it("returns a different hash when order changes", () => {
    expect(computeSetupHash({ setup: ["a", "b"] })).not.toBe(
      computeSetupHash({ setup: ["b", "a"] }),
    );
  });

  it("returns a different hash when env changes", () => {
    expect(
      computeSetupHash({ setup: ["bun install"], env: { NODE_ENV: "dev" } }),
    ).not.toBe(
      computeSetupHash({ setup: ["bun install"], env: { NODE_ENV: "prod" } }),
    );
  });

  it("returns the same hash for empty and undefined env", () => {
    expect(computeSetupHash({ setup: ["x"] })).toBe(
      computeSetupHash({ setup: ["x"], env: {} }),
    );
  });

  it("returns the same hash regardless of env key order", () => {
    expect(computeSetupHash({ setup: ["x"], env: { A: "1", B: "2" } })).toBe(
      computeSetupHash({ setup: ["x"], env: { B: "2", A: "1" } }),
    );
  });
});
