/**
 * Tests for the gesture-detection helpers — pure math used to decide
 * whether a pointer sequence is a click or a drag. Extracted from
 * drag-manager.ts where the same Math.hypot/threshold check appeared in
 * two places (single-point drag + cluster drag).
 *
 * BUG-15 anchor: the original bug was "drag-and-drop release opens the
 * note instead of locking in the value." Root cause: the threshold check
 * was inlined and the cluster-drag path drifted from the single-point
 * path. Centralizing the predicate kills that drift class.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { crossedDragThreshold } from "../drag-gesture";

describe("crossedDragThreshold — concrete cases", () => {
  test("same point with default threshold is NOT a drag (it's a click)", () => {
    expect(crossedDragThreshold(100, 200, 100, 200, 4)).toBe(false);
  });

  test("movement strictly less than threshold is NOT a drag", () => {
    // distance = hypot(2, 2) ≈ 2.83 < 4
    expect(crossedDragThreshold(100, 200, 102, 202, 4)).toBe(false);
  });

  test("movement equal to threshold IS a drag (boundary uses >=)", () => {
    // hypot(3, 4) = 5 with threshold 5 → equal → counts as drag
    expect(crossedDragThreshold(0, 0, 3, 4, 5)).toBe(true);
  });

  test("movement strictly greater than threshold IS a drag", () => {
    expect(crossedDragThreshold(0, 0, 100, 0, 4)).toBe(true);
  });

  test("works for movement in any direction (negative deltas)", () => {
    expect(crossedDragThreshold(100, 200, 50, 200, 4)).toBe(true); // left
    expect(crossedDragThreshold(100, 200, 100, 100, 4)).toBe(true); // up
    expect(crossedDragThreshold(100, 200, 50, 100, 4)).toBe(true); // up-left diag
  });
});

describe("crossedDragThreshold — properties", () => {
  test("symmetry: swapping start and current yields the same answer", () =>
    hegel.test((tc) => {
      const sx = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const sy = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const cx = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const cy = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const t = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      const ab = crossedDragThreshold(sx, sy, cx, cy, t);
      const ba = crossedDragThreshold(cx, cy, sx, sy, t);
      if (ab !== ba) {
        throw new Error(
          `asymmetric: (${sx},${sy})→(${cx},${cy})=${ab} but reversed=${ba}`,
        );
      }
    }));

  test("zero movement is never a drag for any positive threshold", () =>
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const y = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const t = tc.draw(gs.integers({ minValue: 1, maxValue: 100 }));
      if (crossedDragThreshold(x, y, x, y, t)) {
        throw new Error(`zero movement counted as drag at threshold ${t}`);
      }
    }));

  test("monotonic in distance: if (s, a) crosses then (s, b) where b is farther also crosses", () =>
    hegel.test((tc) => {
      // Build two endpoints sharing the same start, where b is strictly
      // farther from start than a (along the same axis to keep this simple).
      const sx = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const sy = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const dxA = tc.draw(gs.integers({ minValue: 1, maxValue: 50 }));
      const extra = tc.draw(gs.integers({ minValue: 1, maxValue: 50 }));
      const dxB = dxA + extra;
      const t = tc.draw(gs.integers({ minValue: 1, maxValue: 100 }));
      const aCrossed = crossedDragThreshold(sx, sy, sx + dxA, sy, t);
      const bCrossed = crossedDragThreshold(sx, sy, sx + dxB, sy, t);
      if (aCrossed && !bCrossed) {
        throw new Error(`monotonicity broken: dxA=${dxA} crossed but dxB=${dxB} did not`);
      }
    }));

  test("monotonic in threshold: if a movement crosses threshold T, it crosses any threshold < T", () =>
    hegel.test((tc) => {
      const sx = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const sy = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const cx = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const cy = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const tBig = tc.draw(gs.integers({ minValue: 1, maxValue: 100 }));
      const tSmall = tc.draw(gs.integers({ minValue: 0, maxValue: tBig }));
      const big = crossedDragThreshold(sx, sy, cx, cy, tBig);
      const small = crossedDragThreshold(sx, sy, cx, cy, tSmall);
      if (big && !small) {
        throw new Error(`tightening threshold should not un-cross: T=${tBig}→${big}, T=${tSmall}→${small}`);
      }
    }));

  test("threshold of zero: any non-equal point counts as a drag", () =>
    hegel.test((tc) => {
      const sx = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const sy = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const cx = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const cy = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const isSame = sx === cx && sy === cy;
      const result = crossedDragThreshold(sx, sy, cx, cy, 0);
      // Zero-threshold means "any non-zero movement is a drag." Same-point is
      // distance 0 which is NOT >= 0... wait, 0 >= 0 is true. So same-point
      // with threshold 0 IS a drag. Document that explicitly:
      if (isSame && !result) {
        throw new Error("threshold=0 should treat same-point as drag (boundary inclusive)");
      }
      if (!isSame && !result) {
        throw new Error(`threshold=0 should treat any non-equal points as drag`);
      }
    }));

  test("never throws for any finite numeric input (robustness)", () =>
    hegel.test((tc) => {
      const sx = tc.draw(gs.integers({ minValue: -1_000_000, maxValue: 1_000_000 }));
      const sy = tc.draw(gs.integers({ minValue: -1_000_000, maxValue: 1_000_000 }));
      const cx = tc.draw(gs.integers({ minValue: -1_000_000, maxValue: 1_000_000 }));
      const cy = tc.draw(gs.integers({ minValue: -1_000_000, maxValue: 1_000_000 }));
      const t = tc.draw(gs.integers({ minValue: 0, maxValue: 1_000_000 }));
      const r = crossedDragThreshold(sx, sy, cx, cy, t);
      if (typeof r !== "boolean") throw new Error(`non-boolean: ${r}`);
    }));
});
