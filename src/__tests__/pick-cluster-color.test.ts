/**
 * Tests for pickClusterColor — the cluster representative color.
 *
 * Extracted from cluster-renderer.ts where the mode-of-members lookup was
 * inlined and depended on Map insertion order for tie-breaking. The "first
 * appearance wins ties" property is documented in the source comment but
 * was not testable. Now it is.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { pickClusterColor } from "../pick-cluster-color";

describe("pickClusterColor — concrete cases", () => {
  test("singleton returns its only color", () => {
    expect(pickClusterColor(["red"])).toBe("red");
  });

  test("all-same returns that color", () => {
    expect(pickClusterColor(["blue", "blue", "blue"])).toBe("blue");
  });

  test("clear majority wins", () => {
    expect(pickClusterColor(["red", "red", "red", "blue"])).toBe("red");
  });

  test("ties broken by first appearance", () => {
    // Both red and blue appear twice. red appears first.
    expect(pickClusterColor(["red", "blue", "red", "blue"])).toBe("red");
  });

  test("ties broken by first appearance — order matters", () => {
    expect(pickClusterColor(["blue", "red", "blue", "red"])).toBe("blue");
  });

  test("three-way tie returns first-appearing color", () => {
    expect(pickClusterColor(["a", "b", "c"])).toBe("a");
    expect(pickClusterColor(["c", "b", "a"])).toBe("c");
  });

  test("empty input throws (clusters always have ≥1 member by construction)", () => {
    expect(() => pickClusterColor([])).toThrow();
  });
});

describe("pickClusterColor — properties", () => {
  test("property: result is always one of the input colors", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
      const colors: string[] = [];
      for (let i = 0; i < n; i++) {
        colors.push(tc.draw(gs.sampledFrom(["red", "green", "blue", "yellow", "purple"])));
      }
      const picked = pickClusterColor(colors);
      if (!colors.includes(picked)) {
        throw new Error(`picked "${picked}" not in input ${JSON.stringify(colors)}`);
      }
    }));

  test("property: result is a mode (no other color has higher count)", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
      const colors: string[] = [];
      for (let i = 0; i < n; i++) {
        colors.push(tc.draw(gs.sampledFrom(["a", "b", "c", "d"])));
      }
      const picked = pickClusterColor(colors);
      const counts = new Map<string, number>();
      for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);
      const pickedCount = counts.get(picked)!;
      for (const [c, count] of counts) {
        if (count > pickedCount) {
          throw new Error(`picked "${picked}" (count ${pickedCount}) but "${c}" has count ${count}`);
        }
      }
    }));

  test("property: deterministic — same input always returns same result", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 8 }));
      const colors: string[] = [];
      for (let i = 0; i < n; i++) {
        colors.push(tc.draw(gs.sampledFrom(["x", "y", "z"])));
      }
      if (pickClusterColor(colors) !== pickClusterColor(colors)) {
        throw new Error(`non-deterministic for ${JSON.stringify(colors)}`);
      }
    }));

  test("property: appending more of the picked color cannot change the pick", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 8 }));
      const colors: string[] = [];
      for (let i = 0; i < n; i++) {
        colors.push(tc.draw(gs.sampledFrom(["a", "b", "c"])));
      }
      const before = pickClusterColor(colors);
      const extras = tc.draw(gs.integers({ minValue: 1, maxValue: 5 }));
      const padded = [...colors, ...Array(extras).fill(before)];
      const after = pickClusterColor(padded);
      if (after !== before) {
        throw new Error(`pick changed from "${before}" to "${after}" after appending more "${before}"`);
      }
    }));
});
