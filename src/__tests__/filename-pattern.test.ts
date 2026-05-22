/**
 * Tests for resolveFilenamePattern — the {N}-token resolver for the
 * optional `newItemFilenamePattern` view config. Pure function, no
 * Obsidian deps, so the tests are property-based where the input space
 * has interesting structure (the prefix/suffix split + max-N scan).
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { resolveFilenamePattern } from "../filename-pattern";

describe("resolveFilenamePattern — null / passthrough", () => {
  test("undefined → null", () => {
    expect(resolveFilenamePattern(undefined, [])).toBeNull();
  });

  test("empty string → null", () => {
    expect(resolveFilenamePattern("", [])).toBeNull();
  });

  test("whitespace-only → null", () => {
    expect(resolveFilenamePattern("   ", [])).toBeNull();
  });

  test("no {N} token → returns pattern verbatim", () => {
    // Bases' own collision counter handles uniqueness when the pattern
    // is static.
    expect(resolveFilenamePattern("static-name", ["whatever"])).toBe("static-name");
  });

  test("multiple {N} tokens → null (ambiguous)", () => {
    // We could pick a semantic (e.g., both substitute to the same value)
    // but null is safer: caller falls back to Bases default, user fixes
    // their pattern.
    expect(resolveFilenamePattern("TODO-{N}-{N}", [])).toBeNull();
  });
});

describe("resolveFilenamePattern — {N} substitution", () => {
  test("empty folder → starts at 1", () => {
    expect(resolveFilenamePattern("TODO-{N}", [])).toBe("TODO-1");
  });

  test("ignores files that don't match prefix+suffix", () => {
    expect(resolveFilenamePattern("TODO-{N}", ["other-1", "ToDo-2"])).toBe("TODO-1");
  });

  test("returns max+1 when matches exist", () => {
    expect(resolveFilenamePattern("TODO-{N}", ["TODO-1", "TODO-5", "TODO-3"])).toBe("TODO-6");
  });

  test("ignores non-numeric middle", () => {
    expect(resolveFilenamePattern("TODO-{N}", ["TODO-foo", "TODO-1a", "TODO-3"])).toBe("TODO-4");
  });

  test("pattern with only {N}", () => {
    expect(resolveFilenamePattern("{N}", ["3", "1", "10"])).toBe("11");
  });

  test("prefix with regex-special chars works (no regex involvement)", () => {
    // v{N}.0 — the `.` would be a regex meta char if we used regex.
    // String startsWith/endsWith doesn't care.
    expect(resolveFilenamePattern("v{N}.0", ["v1.0", "v2.0", "v10.0"])).toBe("v11.0");
  });

  test("suffix can be non-empty", () => {
    expect(resolveFilenamePattern("issue-{N}-draft", ["issue-1-draft", "issue-3-draft"])).toBe("issue-4-draft");
  });

  test("very long number is parsed correctly", () => {
    expect(resolveFilenamePattern("TODO-{N}", ["TODO-999999"])).toBe("TODO-1000000");
  });
});

describe("resolveFilenamePattern — properties", () => {
  test("property: result fits the pattern shape (round-trip)", () =>
    hegel.test((tc) => {
      // Generate a static prefix and suffix from a small alphabet so
      // collisions with hardcoded names are unlikely. Avoid `{` to prevent
      // accidentally producing a second `{N}` token.
      const safeChar = gs.sampledFrom("a", "b", "c", "x", "-", "_", ".");
      const prefix = tc.draw(gs.arrays(safeChar, { minSize: 0, maxSize: 8 })).join("");
      const suffix = tc.draw(gs.arrays(safeChar, { minSize: 0, maxSize: 8 })).join("");
      const pattern = `${prefix}{N}${suffix}`;

      // Random existing basenames — most won't match the pattern; that's fine.
      const noise = tc.draw(gs.arrays(gs.text({ maxLength: 15 }), { minSize: 0, maxSize: 10 }));
      const result = resolveFilenamePattern(pattern, noise);

      // Pattern with one {N} should always produce a string.
      if (result === null) throw new Error(`unexpected null for pattern=${pattern}`);
      // Result must start with prefix and end with suffix.
      if (!result.startsWith(prefix) || !result.endsWith(suffix)) {
        throw new Error(`result ${result} doesn't fit ${prefix}{N}${suffix}`);
      }
      // The middle must be a digit string.
      const middle = result.slice(prefix.length, result.length - suffix.length);
      if (!/^\d+$/.test(middle)) {
        throw new Error(`middle "${middle}" is not all digits`);
      }
    }));

  test("property: idempotent for static patterns (no {N})", () =>
    hegel.test((tc) => {
      // Any pattern without {N} should be returned verbatim regardless of
      // what's already in the folder.
      const pattern = tc.draw(gs.text({ minLength: 1, maxLength: 20 }));
      if (pattern.includes("{N}") || pattern.trim() === "") return;
      const noise = tc.draw(gs.arrays(gs.text({ maxLength: 15 }), { minSize: 0, maxSize: 8 }));
      const result = resolveFilenamePattern(pattern, noise);
      if (result !== pattern) {
        throw new Error(`static pattern ${pattern} mutated to ${result}`);
      }
    }));

  test("property: monotonic — adding the previous result to the folder bumps the next", () =>
    hegel.test((tc) => {
      // Each new call should return a strictly greater N than the last,
      // assuming we add the prior result to the folder.
      const prefix = tc.draw(gs.sampledFrom("TODO-", "ISSUE-", "X-"));
      const pattern = `${prefix}{N}`;
      const folder: string[] = [];
      let last = 0;
      for (let i = 0; i < 5; i++) {
        const r = resolveFilenamePattern(pattern, folder);
        if (r === null) throw new Error("null mid-iteration");
        const n = parseInt(r.slice(prefix.length), 10);
        if (n <= last) throw new Error(`non-monotonic: ${last} → ${n}`);
        folder.push(r);
        last = n;
      }
    }));
});
