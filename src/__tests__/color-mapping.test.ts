/**
 * Tests for color-mapping helpers — category → palette-slot assignment.
 *
 * Design contract (post-collision-fix):
 *   - `colorForCategory(name)` is a pure hash-of-name lookup. Stable per
 *     name, but collisions are possible at any N (birthday paradox).
 *     Used for one-off lookups OUTSIDE a multi-category context.
 *   - `buildColorMap(categories)` is set-aware: deterministic per input
 *     set, but the slot for a given category depends on the OTHER
 *     categories in the set. Linear-probes the hash slot to guarantee
 *     N distinct colors when N ≤ palette length.
 *
 * BUG-18 trade-off: under collision-aware assignment, dropping a category
 * that previously caused another to probe forward CAN shift the probed-to
 * category back. We test "same input set → same map" (stability per set);
 * the stronger "subsetting preserves every slot" property is deliberately
 * abandoned in exchange for guaranteed no-collisions at low N.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  hashCategory,
  colorForCategory,
  buildColorMap,
  DEFAULT_PALETTE,
} from "../color-mapping";

describe("hashCategory — concrete cases", () => {
  test("deterministic: same input always returns same hash", () => {
    expect(hashCategory("personal")).toBe(hashCategory("personal"));
    expect(hashCategory("")).toBe(hashCategory(""));
  });

  test("returns a non-negative integer", () => {
    const h = hashCategory("anything");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  test("different inputs typically give different hashes", () => {
    // Not strictly required by the contract (collisions are allowed) but a
    // sanity check that the function isn't returning a constant.
    expect(hashCategory("a")).not.toBe(hashCategory("b"));
  });
});

describe("hashCategory — properties", () => {
  test("property: deterministic across calls for any string", () =>
    hegel.test((tc) => {
      const s = tc.draw(gs.sampledFrom([
        "", "x", "personal", "freelance", "side-projects",
        "really-long-category-name-with-dashes",
        "café", // unicode
      ]));
      if (hashCategory(s) !== hashCategory(s)) {
        throw new Error(`non-deterministic for "${s}"`);
      }
    }));

  test("property: result is always a non-negative finite integer", () =>
    hegel.test((tc) => {
      const s = tc.draw(gs.sampledFrom(["", "a", "topic", "much-longer-string-here"]));
      const h = hashCategory(s);
      if (!Number.isFinite(h) || !Number.isInteger(h) || h < 0) {
        throw new Error(`bad hash for "${s}": ${h}`);
      }
    }));
});

describe("colorForCategory — palette slot assignment", () => {
  test("returns a value from the default palette", () => {
    const c = colorForCategory("personal");
    expect(DEFAULT_PALETTE).toContain(c);
  });

  test("same category always maps to same palette slot (BUG-18 invariant)", () => {
    expect(colorForCategory("personal")).toBe(colorForCategory("personal"));
  });

  test("custom palette: maps within the supplied palette", () => {
    const palette = ["red", "green", "blue"] as const;
    const c = colorForCategory("test", palette);
    expect(palette).toContain(c);
  });

  test("property: result is independent of which other categories exist", () =>
    hegel.test((tc) => {
      // The bug was: typing "si" in search shrank the visible categories
      // and slots got re-assigned. The pure function couldn't know about
      // "other categories" anyway, but we lock the property: identical input
      // → identical output, no implicit context.
      const cat = tc.draw(gs.sampledFrom([
        "personal", "freelance", "side-projects", "health", "topic-x", "x",
      ]));
      const a = colorForCategory(cat);
      const b = colorForCategory(cat); // independent call
      if (a !== b) throw new Error(`color shifted between calls for "${cat}"`);
    }));
});

describe("buildColorMap — full dataset assignment", () => {
  test("empty input → empty map", () => {
    const map = buildColorMap([]);
    expect(map.size).toBe(0);
  });

  test("each unique category gets exactly one entry", () => {
    const map = buildColorMap(["a", "b", "a", "c", "b"]);
    expect(map.size).toBe(3);
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(true);
    expect(map.has("c")).toBe(true);
  });

  test("each entry is a palette color", () => {
    const map = buildColorMap(["x", "y", "z"]);
    for (const color of map.values()) {
      expect(DEFAULT_PALETTE).toContain(color);
    }
  });

  test("property: N ≤ palette.length distinct categories → N distinct colors", () =>
    hegel.test((tc) => {
      // The core invariant of collision-aware assignment: as long as there
      // are enough palette slots for every category, no two should collide.
      // This is the property the OLD pure-hash design could not guarantee.
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: DEFAULT_PALETTE.length }));
      const cats: string[] = [];
      for (let i = 0; i < n; i++) {
        const stem = tc.draw(gs.sampledFrom(["cat", "tag", "area", "topic", "kind", "bucket"]));
        cats.push(`${stem}-${i}`);
      }
      const map = buildColorMap(cats);
      const colors = [...map.values()];
      if (new Set(colors).size !== cats.length) {
        throw new Error(
          `${cats.length} distinct categories produced only ${new Set(colors).size} distinct colors: ${JSON.stringify([...map.entries()])}`,
        );
      }
    }));

  test("property: stability per input set — same set → same map (BUG-18 weak form)", () =>
    hegel.test((tc) => {
      // Stronger "subsetting preserves slots" is deliberately gone; this is
      // what remains. Same categories in any order → same color assignment.
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 20 }));
      const cats: string[] = [];
      for (let i = 0; i < n; i++) cats.push(`cat-${i}`);
      const a = buildColorMap(cats);
      const b = buildColorMap(cats);
      for (const k of a.keys()) {
        if (a.get(k) !== b.get(k)) {
          throw new Error(`unstable: "${k}" got ${a.get(k)} vs ${b.get(k)}`);
        }
      }
    }));

  test("property: result size equals number of unique inputs", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 0, maxValue: 30 }));
      const inputs: string[] = [];
      for (let i = 0; i < n; i++) {
        // Force some duplication via small key space.
        inputs.push(`cat-${tc.draw(gs.integers({ minValue: 0, maxValue: 5 }))}`);
      }
      const expected = new Set(inputs).size;
      const map = buildColorMap(inputs);
      if (map.size !== expected) {
        throw new Error(`got ${map.size} entries, expected ${expected} unique`);
      }
    }));

  test("property: insertion order doesn't affect the resulting map's contents", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 10 }));
      const inputs: string[] = [];
      for (let i = 0; i < n; i++) inputs.push(`cat-${i}`);
      const reversed = [...inputs].reverse();

      const a = buildColorMap(inputs);
      const b = buildColorMap(reversed);
      // Map iteration order may differ; compare entries by key.
      if (a.size !== b.size) throw new Error(`size differs: ${a.size} vs ${b.size}`);
      for (const k of a.keys()) {
        if (a.get(k) !== b.get(k)) {
          throw new Error(`color for "${k}" differs by insertion order`);
        }
      }
    }));
});
