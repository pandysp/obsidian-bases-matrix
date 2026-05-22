/**
 * Tests for the pure label-layout algorithm. The algorithm decides flip
 * side per group based only on plot-edge overflow — no label-vs-label
 * resolution, no label-vs-dot resolution. Tests cover the edge-flip
 * decision and group-flips-together invariants.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  layoutLabels,
  type LayoutLabel,
  type PlotBounds,
} from "../label-layout";

const PLOT: PlotBounds = { left: 72, right: 800, top: 24, bottom: 400 };

function singleton(
  filePath: string,
  cx: number,
  cy: number,
  width = 180,
): LayoutLabel {
  return {
    filePath,
    groupId: filePath,
    cx,
    cy,
    width,
    height: 28,
    offsetX: 16, // baseRadius 8 + label gap 8
    initialAnchorY: cy + 4,
    flippable: true,
  };
}

describe("singleton edge-flip", () => {
  test("right-edge singleton flips left to avoid overflow", () => {
    const labels = [singleton("A", 750, 200)];
    const result = layoutLabels(labels, PLOT);
    expect(result.get("A")!.flipped).toBe(true);
  });

  test("center singleton stays right (no overflow)", () => {
    const labels = [singleton("A", 400, 200)];
    const result = layoutLabels(labels, PLOT);
    expect(result.get("A")!.flipped).toBe(false);
  });

  test("left-edge singleton with very long label stays right (tiebreaker on both-sides-overflow)", () => {
    // cx=100, width=900 — unflipped right edge = 100+16+900=1016 > 800 (overflows right).
    // Flipped left edge = 100-16-900 = -816 < 72 (overflows left).
    // Both sides overflow → tiebreaker keeps it on the right.
    const labels = [singleton("A", 100, 200, 900)];
    const result = layoutLabels(labels, PLOT);
    expect(result.get("A")!.flipped).toBe(false);
  });

  test("anchor Y is never moved by layout", () => {
    const labels = [singleton("A", 400, 250)];
    const result = layoutLabels(labels, PLOT);
    expect(result.get("A")!.anchorY).toBe(250 + 4); // singleton helper sets initialAnchorY = cy + 4
  });

  test("anchor X matches cx + offsetX when not flipped, cx - offsetX when flipped", () => {
    const right = layoutLabels([singleton("R", 400, 200)], PLOT);
    expect(right.get("R")!.anchorX).toBe(400 + 16);

    const left = layoutLabels([singleton("L", 750, 200)], PLOT);
    expect(left.get("L")!.anchorX).toBe(750 - 16);
  });
});

describe("non-flippable labels (radial spider petals)", () => {
  test("non-flippable label is excluded from the result", () => {
    const radial: LayoutLabel = {
      filePath: "P0",
      groupId: "BIG",
      cx: 400, cy: 200,
      width: 200, height: 28,
      offsetX: 100,
      initialAnchorY: 200,
      flippable: false,
    };
    const result = layoutLabels([radial], PLOT);
    expect(result.has("P0")).toBe(false);
  });

  test("a mix of flippable and non-flippable labels — only flippable ones appear", () => {
    const radial: LayoutLabel = {
      filePath: "P0",
      groupId: "BIG",
      cx: 400, cy: 200,
      width: 200, height: 28,
      offsetX: 100,
      initialAnchorY: 200,
      flippable: false,
    };
    const sing = singleton("S", 400, 200);
    const result = layoutLabels([radial, sing], PLOT);
    expect(result.has("P0")).toBe(false);
    expect(result.has("S")).toBe(true);
  });
});

describe("layout invariants (property tests)", () => {
  function arbitrarySingletons(tc: { draw: <T>(g: unknown) => T }): LayoutLabel[] {
    const count = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
    const labels: LayoutLabel[] = [];
    for (let i = 0; i < count; i++) {
      const cx = tc.draw(gs.integers({ minValue: -50, maxValue: 900 }));
      const cy = tc.draw(gs.integers({ minValue: -50, maxValue: 450 }));
      const width = tc.draw(gs.integers({ minValue: 1, maxValue: 600 }));
      labels.push(singleton(`P${i}`, cx, cy, width));
    }
    return labels;
  }

  test("every flippable input label has a placement in the output", () =>
    hegel.test((tc) => {
      const labels = arbitrarySingletons(tc);
      const result = layoutLabels(labels, PLOT);
      for (const l of labels) {
        if (!result.get(l.filePath)) {
          throw new Error(`Missing placement for ${l.filePath}`);
        }
      }
    }));

  test("layout is deterministic — same input produces same output", () =>
    hegel.test((tc) => {
      const labels = arbitrarySingletons(tc);
      const r1 = layoutLabels(labels, PLOT);
      const r2 = layoutLabels(labels, PLOT);
      for (const l of labels) {
        const a = r1.get(l.filePath)!;
        const b = r2.get(l.filePath)!;
        if (a.anchorX !== b.anchorX || a.anchorY !== b.anchorY || a.flipped !== b.flipped) {
          throw new Error(`Non-deterministic for ${l.filePath}`);
        }
      }
    }));

  test("flip decision is symmetric under x-mirroring around plot center", () =>
    hegel.test((tc) => {
      // The algorithm has no internal left/right asymmetry — it treats both
      // edges identically. Mirroring all x coords around the plot's horizontal
      // center swaps the roles of "overflows right" and "overflows left".
      // Therefore:
      //  - if exactly one side overflows → orig vs mirror flip decisions are
      //    opposites (the one that overflows is the one that flips).
      //  - if neither overflows → both stay unflipped (no flip needed).
      //  - if both overflow → both stay unflipped (right-wins tiebreaker
      //    applies in both runs).
      const labels = arbitrarySingletons(tc);
      const mid = PLOT.left + PLOT.right;
      const mirrored = labels.map((l) => singleton(l.filePath, mid - l.cx, l.cy, l.width));
      const orig = layoutLabels(labels, PLOT);
      const mirr = layoutLabels(mirrored, PLOT);
      for (const l of labels) {
        const o = orig.get(l.filePath)!;
        const m = mirr.get(l.filePath)!;
        const overflowsRight = l.cx + l.offsetX + l.width > PLOT.right;
        const overflowsLeftIfFlipped = l.cx - l.offsetX - l.width < PLOT.left;
        const exactlyOne = overflowsRight !== overflowsLeftIfFlipped;
        if (exactlyOne) {
          if (o.flipped === m.flipped) {
            throw new Error(
              `Symmetry broken for ${l.filePath}: cx=${l.cx} w=${l.width}, orig.flipped=${o.flipped}, mirr.flipped=${m.flipped} (should be opposites)`,
            );
          }
        } else {
          if (o.flipped || m.flipped) {
            throw new Error(
              `Non-flip case broken for ${l.filePath}: cx=${l.cx} w=${l.width}, orig.flipped=${o.flipped}, mirr.flipped=${m.flipped} (both should be false)`,
            );
          }
        }
      }
    }));

  test("a flipped placement never overflows plot.left (unless it was the both-sides tiebreaker)", () =>
    hegel.test((tc) => {
      // Generator covers wide labels and dots near both edges.
      const labels = arbitrarySingletons(tc);
      const result = layoutLabels(labels, PLOT);
      for (const l of labels) {
        const p = result.get(l.filePath)!;
        if (!p.flipped) continue;
        const leftEdge = p.anchorX - l.width;
        // Flipped only when flipping doesn't overflow left. If we ended up
        // flipped, leftEdge >= plot.left must hold.
        if (leftEdge < PLOT.left) {
          throw new Error(
            `Flipped label overflows left: ${l.filePath} anchorX=${p.anchorX} width=${l.width} leftEdge=${leftEdge} plot.left=${PLOT.left}`,
          );
        }
      }
    }));
});
