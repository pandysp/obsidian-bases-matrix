/**
 * Tests for the label-layout adapter — the boundary between point-renderer's
 * SVG-world data and the pure label-layout module.
 *
 * The cluster-member layout path is gone (clusters render as a count glyph
 * and don't contribute member labels to the layout pass). Only singleton
 * conversion and the orchestrator's singleton-only behavior are tested.
 */
import { describe, expect, test } from "vitest";
import { runLayout, singletonToLayoutLabel } from "../label-layout-adapter";

describe("singletonToLayoutLabel", () => {
  test("converts a singleton to LayoutLabel shape", () => {
    const result = singletonToLayoutLabel({
      filePath: "A",
      cx: 200,
      cy: 100,
      radius: 8,
      labelWidth: 150,
      labelHeight: 28,
      initialAnchorY: 104,
    });

    expect(result).toEqual({
      filePath: "A",
      groupId: "A",          // singletons are their own group
      cx: 200,
      cy: 100,
      width: 150,
      height: 28,
      offsetX: 16,           // radius + 8
      initialAnchorY: 104,
      flippable: true,
    });
  });
});

describe("runLayout (orchestrator)", () => {
  test("singleton near right edge ends up flipped in the result", () => {
    const result = runLayout({
      singletons: [
        { filePath: "A", cx: 770, cy: 100, radius: 8, labelWidth: 150, labelHeight: 28, initialAnchorY: 104 },
      ],
      clusters: [],
      plotBounds: { left: 72, right: 800, top: 24, bottom: 400 },
    });
    expect(result.get("A")!.flipped).toBe(true);
  });

  test("singleton far from any edge stays unflipped", () => {
    const result = runLayout({
      singletons: [
        { filePath: "A", cx: 400, cy: 200, radius: 8, labelWidth: 100, labelHeight: 28, initialAnchorY: 204 },
      ],
      clusters: [],
      plotBounds: { left: 72, right: 800, top: 24, bottom: 400 },
    });
    expect(result.get("A")!.flipped).toBe(false);
  });

  test("clusters input is accepted as an empty array (placeholder)", () => {
    // The `clusters` field is preserved on the input shape for stability
    // but no longer contributes any layout labels.
    const result = runLayout({
      singletons: [
        { filePath: "S1", cx: 200, cy: 100, radius: 8, labelWidth: 100, labelHeight: 28, initialAnchorY: 104 },
      ],
      clusters: [],
      plotBounds: { left: 72, right: 800, top: 24, bottom: 400 },
    });
    expect(result.has("S1")).toBe(true);
    expect(result.size).toBe(1);
  });
});
