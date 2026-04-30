/**
 * Smoke test: confirms the module loads under the standard test pattern.
 * Full DOM rendering tests are out of scope for the bun unit-test runner;
 * the availability-mapping logic is exercised indirectly via the
 * connection-status route tests.
 */
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { ProviderTabs } = await import("./provider-tabs");

describe("ProviderTabs module", () => {
  test("exports a component", () => {
    expect(typeof ProviderTabs).toBe("function");
  });
});
