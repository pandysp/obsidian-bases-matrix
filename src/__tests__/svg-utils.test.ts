/**
 * Tests for svg-utils — the tick-generation and formatting helpers used
 * by the axes renderer. The main thing being pinned here is that
 * niceTicks doesn't leak FP imprecision into rendered tick labels.
 */
import { describe, expect, test } from "vitest";
import { niceTicks, formatTick } from "../svg-utils";

describe("niceTicks", () => {
  test("0..10 produces clean integer ticks", () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  // Regression: data-derived bounds with non-clean padding produce values
  // like 0.1 + 0.2 = 0.30000000000000004. The loop's snap-to-step protects
  // step-aligned ticks, but the boundary unshift/push of raw min/max bypassed
  // the cleanup and could leak FP tails directly into axis labels via
  // String(value) in non-numeric type paths (or any other code that doesn't
  // go through formatTick's rounding).
  test("FP-imprecise endpoints get cleaned before being pushed as boundary ticks", () => {
    // 0.1 + 0.2 is a well-known FP imprecision in IEEE 754 doubles.
    const min = 0.1 + 0.2;          // 0.30000000000000004
    expect(String(min)).toBe("0.30000000000000004"); // confirm the bug exists
    const ticks = niceTicks(min, 5);
    // First tick is the boundary unshift. After cleaning it should display
    // cleanly (no 17-digit FP tail).
    expect(String(ticks[0]).length).toBeLessThan(8);
    expect(ticks[0]).toBe(0.3);
  });

  test("preserves real user precision (3-decimal value survives)", () => {
    // Cleaning to 10 sig figs must not destroy genuine precision. Pick a
    // range where boundary unshift definitely fires (first tick far from min).
    const ticks = niceTicks(0.001, 0.987);
    // Should include 0.001 as the first tick (boundary unshift), still that value.
    expect(ticks[0]).toBe(0.001);
  });

  test("handles inverted/degenerate ranges without crashing", () => {
    expect(niceTicks(5, 5)).toEqual([5, 5]);  // span 0 → return [min, max]
    expect(niceTicks(10, 0)).toEqual([10, 0]); // inverted → return [min, max]
  });
});

describe("formatTick", () => {
  test("integers render bare", () => {
    expect(formatTick(0)).toBe("0");
    expect(formatTick(10)).toBe("10");
    expect(formatTick(-3)).toBe("-3");
  });

  test("non-integers round to 2 decimal places", () => {
    expect(formatTick(0.65)).toBe("0.65");
    expect(formatTick(1.5)).toBe("1.5");
    expect(formatTick(0.6499999999999999)).toBe("0.65"); // FP tail killed
  });
});
