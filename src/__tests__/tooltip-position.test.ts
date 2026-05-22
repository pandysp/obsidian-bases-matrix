/**
 * Tests for computeTooltipPosition — pure tooltip placement math.
 *
 * Extracted from tooltip.show() where the down-right-default + flip-on-
 * overflow + clamp-to-edge-padding logic was inlined and split across
 * an initial pass and a rAF-deferred pass. The DOM layer (rAF, getBBox)
 * stays in tooltip.ts; this module owns just the geometry.
 *
 * BUG-38 anchor: tooltip placement is exactly the kind of geometric
 * placement-with-collision-detection that's easy to get wrong (off-by-one,
 * unflipped overflow, missing edge-padding). Properties pin it down.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { computeTooltipPosition, type TooltipPositionInput } from "../tooltip-position";

const STD: Pick<TooltipPositionInput, "scope" | "tip" | "offset" | "edgePadding"> = {
  scope: { width: 800, height: 600 },
  tip: { width: 200, height: 100 },
  offset: 14,
  edgePadding: 4,
};

describe("computeTooltipPosition — concrete cases", () => {
  test("cursor in center: tooltip placed down-right of cursor", () => {
    const r = computeTooltipPosition({ cursor: { x: 400, y: 300 }, ...STD });
    expect(r.left).toBe(414); // 400 + 14
    expect(r.top).toBe(314);  // 300 + 14
  });

  test("cursor near right edge: tooltip flips to the left of cursor", () => {
    // Cursor at x=750, tip width 200, offset 14: down-right would put
    // right edge at 750 + 14 + 200 = 964 > 800 - 4 = 796. Flip left.
    const r = computeTooltipPosition({ cursor: { x: 750, y: 300 }, ...STD });
    // Flipped: left = 750 - 200 - 14 = 536
    expect(r.left).toBe(536);
    expect(r.top).toBe(314);
  });

  test("cursor near bottom edge: tooltip flips above cursor", () => {
    const r = computeTooltipPosition({ cursor: { x: 400, y: 550 }, ...STD });
    // Flipped: top = 550 - 100 - 14 = 436
    expect(r.left).toBe(414);
    expect(r.top).toBe(436);
  });

  test("cursor near both edges: tooltip flips both ways", () => {
    const r = computeTooltipPosition({ cursor: { x: 750, y: 550 }, ...STD });
    expect(r.left).toBe(536);
    expect(r.top).toBe(436);
  });

  test("flipped position would underflow left: clamped to edgePadding", () => {
    // Tip larger than scope.width; flip would put left far negative.
    const r = computeTooltipPosition({
      cursor: { x: 750, y: 300 },
      scope: { width: 800, height: 600 },
      tip: { width: 900, height: 100 }, // wider than scope
      offset: 14, edgePadding: 4,
    });
    expect(r.left).toBe(4); // clamped to edgePadding
  });

  test("flipped position would underflow top: clamped to edgePadding", () => {
    const r = computeTooltipPosition({
      cursor: { x: 400, y: 550 },
      scope: { width: 800, height: 600 },
      tip: { width: 200, height: 700 }, // taller than scope
      offset: 14, edgePadding: 4,
    });
    expect(r.top).toBe(4);
  });
});

describe("computeTooltipPosition — properties", () => {
  test("property: result left is always >= edgePadding", () =>
    hegel.test((tc) => {
      const cx = tc.draw(gs.integers({ minValue: 0, maxValue: 800 }));
      const cy = tc.draw(gs.integers({ minValue: 0, maxValue: 600 }));
      const tipW = tc.draw(gs.integers({ minValue: 50, maxValue: 1000 }));
      const tipH = tc.draw(gs.integers({ minValue: 30, maxValue: 800 }));
      const r = computeTooltipPosition({
        cursor: { x: cx, y: cy },
        scope: { width: 800, height: 600 },
        tip: { width: tipW, height: tipH },
        offset: 14, edgePadding: 4,
      });
      if (r.left < 4) throw new Error(`left=${r.left} < edgePadding=4`);
      if (r.top < 4) throw new Error(`top=${r.top} < edgePadding=4`);
    }));

  test("property: when nothing overflows, position is cursor + offset", () =>
    hegel.test((tc) => {
      // Pick a cursor + tip combo where the down-right placement comfortably
      // fits inside the scope.
      const tipW = tc.draw(gs.integers({ minValue: 50, maxValue: 200 }));
      const tipH = tc.draw(gs.integers({ minValue: 30, maxValue: 100 }));
      const cx = tc.draw(gs.integers({ minValue: 0, maxValue: 800 - tipW - 50 }));
      const cy = tc.draw(gs.integers({ minValue: 0, maxValue: 600 - tipH - 50 }));
      const r = computeTooltipPosition({
        cursor: { x: cx, y: cy },
        scope: { width: 800, height: 600 },
        tip: { width: tipW, height: tipH },
        offset: 14, edgePadding: 4,
      });
      if (r.left !== cx + 14) throw new Error(`expected left=${cx + 14}, got ${r.left}`);
      if (r.top !== cy + 14) throw new Error(`expected top=${cy + 14}, got ${r.top}`);
    }));

  test("property: a tooltip always small enough to fit somewhere stays inside the scope (when not clamped)", () =>
    hegel.test((tc) => {
      // Generate inputs where tip fits in the scope (so flip-without-clamp works).
      const tipW = tc.draw(gs.integers({ minValue: 50, maxValue: 400 }));
      const tipH = tc.draw(gs.integers({ minValue: 30, maxValue: 200 }));
      const cx = tc.draw(gs.integers({ minValue: 0, maxValue: 800 }));
      const cy = tc.draw(gs.integers({ minValue: 0, maxValue: 600 }));
      const r = computeTooltipPosition({
        cursor: { x: cx, y: cy },
        scope: { width: 800, height: 600 },
        tip: { width: tipW, height: tipH },
        offset: 14, edgePadding: 4,
      });
      // Since tip fits (tipW <= 400 << 800, tipH <= 200 << 600), result must
      // stay inside scope after any flip; no clamping should be needed.
      if (r.left + tipW > 800) {
        throw new Error(`tooltip overflows right: left=${r.left}, tipW=${tipW}, scope=800`);
      }
      if (r.top + tipH > 600) {
        throw new Error(`tooltip overflows bottom: top=${r.top}, tipH=${tipH}, scope=600`);
      }
    }));

  test("property: deterministic — same input always returns same position", () =>
    hegel.test((tc) => {
      const cx = tc.draw(gs.integers({ minValue: 0, maxValue: 800 }));
      const cy = tc.draw(gs.integers({ minValue: 0, maxValue: 600 }));
      const a = computeTooltipPosition({ cursor: { x: cx, y: cy }, ...STD });
      const b = computeTooltipPosition({ cursor: { x: cx, y: cy }, ...STD });
      if (a.left !== b.left || a.top !== b.top) {
        throw new Error(`non-deterministic: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      }
    }));

  test("property: small cursor movement produces small position change (continuity)", () =>
    hegel.test((tc) => {
      // No flip: cursor in interior, tip fits comfortably. Moving cursor by 1
      // pixel should move position by at most a few pixels (no jumps).
      const cx = tc.draw(gs.integers({ minValue: 100, maxValue: 400 }));
      const cy = tc.draw(gs.integers({ minValue: 100, maxValue: 300 }));
      const a = computeTooltipPosition({ cursor: { x: cx, y: cy }, ...STD });
      const b = computeTooltipPosition({ cursor: { x: cx + 1, y: cy + 1 }, ...STD });
      if (Math.abs(b.left - a.left) > 5 || Math.abs(b.top - a.top) > 5) {
        throw new Error(`position jumped on small cursor move: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
      }
    }));
});
