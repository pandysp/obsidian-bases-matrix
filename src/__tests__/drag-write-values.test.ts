/**
 * Tests for computeDragWriteValues — what a drag commit writes back to
 * frontmatter for each axis. Two threads:
 *
 *   - Numeric axes: the legacy 2x2-matrix behavior. Exact-bypasses-rounding
 *     for snap-to-point (no float drift). Non-exact rounds to the axis
 *     range's nice decimal precision.
 *
 *   - Time / date axes: format the number back to the user's native string
 *     ("5:30", "2025-06-15") so the .md file keeps that format on every
 *     drag instead of getting "330" or a giant timestamp.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { computeDragWriteValues } from "../drag-write-values";
import { parseValue } from "../value-type";

describe("computeDragWriteValues — numeric (legacy 2x2-matrix path)", () => {
  test("exact mode preserves input bit-exactly", () => {
    expect(computeDragWriteValues({
      xValue: 7.123456789, yValue: 3.987654321,
      xRange: 10, yRange: 10, xType: "numeric", yType: "numeric", exact: true,
    })).toEqual({ x: 7.123456789, y: 3.987654321 });
  });

  test("non-exact rounds per axis range (range 10 → 1 decimal)", () => {
    expect(computeDragWriteValues({
      xValue: 7.34, yValue: 3.98,
      xRange: 10, yRange: 10, xType: "numeric", yType: "numeric", exact: false,
    })).toEqual({ x: 7.3, y: 4.0 });
  });

  test("non-exact rounds x and y independently per their own ranges", () => {
    expect(computeDragWriteValues({
      xValue: 0.567, yValue: 7.4,
      xRange: 1, yRange: 100, xType: "numeric", yType: "numeric", exact: false,
    })).toEqual({ x: 0.57, y: 7 });
  });

  test("non-exact with zero range passes through (matches roundForRange contract)", () => {
    expect(computeDragWriteValues({
      xValue: 7.34, yValue: 3.98,
      xRange: 0, yRange: 0, xType: "numeric", yType: "numeric", exact: false,
    })).toEqual({ x: 7.34, y: 3.98 });
  });

  test("property: exact mode is the identity", () =>
    hegel.test((tc) => {
      const xValue = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const yValue = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const xRange = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
      const yRange = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
      const r = computeDragWriteValues({
        xValue, yValue, xRange, yRange,
        xType: "numeric", yType: "numeric", exact: true,
      });
      if (r.x !== xValue) throw new Error(`exact mode mutated x: ${xValue} → ${r.x}`);
      if (r.y !== yValue) throw new Error(`exact mode mutated y: ${yValue} → ${r.y}`);
    }));

  test("property: x and y are independent (changing y range doesn't affect x output)", () =>
    hegel.test((tc) => {
      const xValue = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const yValue = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const xRange = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const yRangeA = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const yRangeB = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const a = computeDragWriteValues({
        xValue, yValue, xRange, yRange: yRangeA,
        xType: "numeric", yType: "numeric", exact: false,
      });
      const b = computeDragWriteValues({
        xValue, yValue, xRange, yRange: yRangeB,
        xType: "numeric", yType: "numeric", exact: false,
      });
      if (a.x !== b.x) throw new Error(`x changed when only y range changed: ${a.x} vs ${b.x}`);
    }));

  test("property: idempotent in non-exact mode (rounding the result again is a no-op)", () =>
    hegel.test((tc) => {
      const xValue = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const yValue = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const xRange = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const yRange = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const once = computeDragWriteValues({
        xValue, yValue, xRange, yRange,
        xType: "numeric", yType: "numeric", exact: false,
      });
      const twice = computeDragWriteValues({
        xValue: once.x as number, yValue: once.y as number, xRange, yRange,
        xType: "numeric", yType: "numeric", exact: false,
      });
      if (Math.abs((once.x as number) - (twice.x as number)) > 1e-9) throw new Error(`x not idempotent: ${once.x} → ${twice.x}`);
      if (Math.abs((once.y as number) - (twice.y as number)) > 1e-9) throw new Error(`y not idempotent: ${once.y} → ${twice.y}`);
    }));
});

describe("computeDragWriteValues — time axis writes back time strings", () => {
  test("time y-axis writes '5:30' not 330", () => {
    const r = computeDragWriteValues({
      xValue: 100, yValue: 330,
      xRange: 200, yRange: 100,
      xType: "numeric", yType: "time", exact: false,
    });
    expect(r.x).toBe(100);
    expect(r.y).toBe("5:30");
  });

  test("time x-axis writes '0:45' for 45 seconds", () => {
    const r = computeDragWriteValues({
      xValue: 45, yValue: 0,
      xRange: 100, yRange: 10,
      xType: "time", yType: "numeric", exact: false,
    });
    expect(r.x).toBe("0:45");
  });

  test("fractional seconds round to whole-second strings", () => {
    // Dragging produces non-integer seconds from pixel-to-data; format
    // should round to a clean MM:SS.
    expect(computeDragWriteValues({
      xValue: 0, yValue: 330.7,
      xRange: 100, yRange: 100,
      xType: "numeric", yType: "time", exact: false,
    }).y).toBe("5:31");
  });

  test("exact mode (snap-to-point) still formats — time axes don't need numeric exactness", () => {
    // The snap target is itself a formatted time; writing the formatted
    // string back keeps the bit-exact-clustering property because two
    // members snapping to the same target produce the same string.
    expect(computeDragWriteValues({
      xValue: 100, yValue: 345,
      xRange: 200, yRange: 100,
      xType: "numeric", yType: "time", exact: true,
    }).y).toBe("5:45");
  });

  test("property: round-trip — drag-write a time value, re-parse → same canonical seconds", () =>
    hegel.test((tc) => {
      // Generated seconds in [0, 359999] (up to 99:59:59). The number that
      // goes IN may not exactly equal the number that comes OUT (formatTime
      // rounds to whole seconds), so the property is: round-trip-after-
      // round-trip is stable.
      const seconds = tc.draw(gs.integers({ minValue: 0, maxValue: 359999 }));
      const written = computeDragWriteValues({
        xValue: 0, yValue: seconds,
        xRange: 1, yRange: 1000,
        xType: "numeric", yType: "time", exact: false,
      }).y as string;
      const reparsed = parseValue(written, "time");
      // After rounding to integer seconds, re-parsing equals the rounded
      // input (already an integer here) bit-exactly.
      if (reparsed !== seconds) {
        throw new Error(`round-trip failed: ${seconds} → "${written}" → ${reparsed}`);
      }
    }));
});

describe("computeDragWriteValues — date axis writes back date strings", () => {
  test("date y-axis writes 'YYYY-MM-DD' not a raw timestamp", () => {
    // Jan 15, 2024 00:00 UTC = 1705276800000 ms
    const ts = Date.parse("2024-01-15");
    const r = computeDragWriteValues({
      xValue: ts, yValue: 0,
      xRange: 86_400_000 * 365, yRange: 10,
      xType: "date", yType: "numeric", exact: false,
    });
    expect(r.x).toBe("2024-01-15");
    expect(r.y).toBe(0);
  });

  test("property: round-trip — date-write → re-parse → identical timestamp", () =>
    hegel.test((tc) => {
      const year = tc.draw(gs.integers({ minValue: 2000, maxValue: 2050 }));
      const month = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
      const day = tc.draw(gs.integers({ minValue: 1, maxValue: 28 }));
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const ts = Date.parse(iso);
      const written = computeDragWriteValues({
        xValue: ts, yValue: 0,
        xRange: 1, yRange: 1,
        xType: "date", yType: "numeric", exact: false,
      }).x as string;
      if (written !== iso) {
        throw new Error(`date round-trip failed: ${iso} → ${ts} → "${written}"`);
      }
    }));
});

describe("computeDragWriteValues — mixed-type axes (real plugin scenarios)", () => {
  // The 5k training-log example: x=date, y=time. The most likely real-world
  // case for this codepath outside the legacy numeric matrix.
  test("date x + time y: both axes format to their native grammar", () => {
    const r = computeDragWriteValues({
      xValue: Date.parse("2025-06-15"),
      yValue: 345, // 5:45
      xRange: 86_400_000 * 365,
      yRange: 200,
      xType: "date", yType: "time", exact: false,
    });
    expect(r.x).toBe("2025-06-15");
    expect(r.y).toBe("5:45");
  });

  test("numeric x + time y: x rounded as before, y formatted", () => {
    const r = computeDragWriteValues({
      xValue: 7.34, yValue: 380, // 6:20
      xRange: 10, yRange: 200,
      xType: "numeric", yType: "time", exact: false,
    });
    expect(r.x).toBe(7.3);
    expect(r.y).toBe("6:20");
  });
});
