import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

/**
 * Harness smoke test — confirms vitest + Hegel both run before we wire up
 * tests against actual plugin code.
 */
describe("test harness", () => {
  test("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });

  test("hegel property test runs", () =>
    hegel.test((tc) => {
      const a = tc.draw(gs.integers());
      const b = tc.draw(gs.integers());
      // commutativity of addition — should always hold
      if (a + b !== b + a) {
        throw new Error(`${a} + ${b} != ${b} + ${a}`);
      }
    }));
});
