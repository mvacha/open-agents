import { describe, expect, it } from "bun:test";
import { shellQuote } from "./sandbox-paths";

describe("shellQuote", () => {
  it("wraps simple values in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
  });

  it("preserves shell metacharacters as literals", () => {
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
    expect(shellQuote("`id`")).toBe("'`id`'");
  });
});
