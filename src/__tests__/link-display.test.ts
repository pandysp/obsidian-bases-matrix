/**
 * Tests for extractLinkDisplay — pure wikilink display-text extraction.
 *
 * Extracted from formatValueForChip, where the regex-based parsing of
 * `[[target|alias]]` strings was inlined inside the LinkValue branch.
 * The pure helper takes a raw wikilink string (what LinkValue.toString()
 * returns) and is fully testable without Obsidian's class machinery.
 *
 * Bug-prone surface: the regex needs to handle alias presence/absence,
 * nested paths (`folder/sub/file`), and gracefully fall back when input
 * doesn't look like a wikilink at all (formatValueForChip returns the raw
 * string in that case — we mirror it here).
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { extractLinkDisplay } from "../link-display";

describe("extractLinkDisplay — concrete cases", () => {
  test("simple link returns the target", () => {
    expect(extractLinkDisplay("[[Foo]]")).toBe("Foo");
  });

  test("link with alias returns the alias", () => {
    expect(extractLinkDisplay("[[Foo|Bar]]")).toBe("Bar");
  });

  test("path link returns the basename, not the full path", () => {
    expect(extractLinkDisplay("[[notes/freelance/wscad]]")).toBe("wscad");
  });

  test("path link with alias prefers alias over basename", () => {
    expect(extractLinkDisplay("[[notes/freelance/wscad|WSCAD AG]]")).toBe("WSCAD AG");
  });

  test("non-wikilink input returns the raw string unchanged", () => {
    expect(extractLinkDisplay("plain text")).toBe("plain text");
    expect(extractLinkDisplay("")).toBe("");
  });

  test("alias with spaces preserves them", () => {
    expect(extractLinkDisplay("[[a|two words]]")).toBe("two words");
  });

  test("malformed wikilink (unclosed) returns raw", () => {
    expect(extractLinkDisplay("[[Foo")).toBe("[[Foo");
  });

  test("multiple pipes: target is everything before first |, alias is the rest", () => {
    // The regex's target group `[^|\]]+` rejects pipes in the target, but
    // the alias group `[^\]]+` ALLOWS pipes. So `[[a|b|c]]` parses as
    // target="a", alias="b|c". This was a misread on my first pass — the
    // property test caught it. Locking the actual behavior so it's pinned.
    expect(extractLinkDisplay("[[a|b|c]]")).toBe("b|c");
  });
});

describe("extractLinkDisplay — properties", () => {
  test("property: alias takes priority over target when both present", () =>
    hegel.test((tc) => {
      const target = tc.draw(gs.sampledFrom(["a", "folder/file", "deeply/nested/path/x"]));
      const alias = tc.draw(gs.sampledFrom(["alias1", "Display Name", "x"]));
      const raw = `[[${target}|${alias}]]`;
      const r = extractLinkDisplay(raw);
      if (r !== alias) {
        throw new Error(`expected alias "${alias}", got "${r}" from "${raw}"`);
      }
    }));

  test("property: bare-target link returns the basename (last path segment)", () =>
    hegel.test((tc) => {
      const segments = tc.draw(gs.integers({ minValue: 1, maxValue: 5 }));
      const parts = Array.from({ length: segments }, (_, i) => `seg${i}`);
      const raw = `[[${parts.join("/")}]]`;
      const r = extractLinkDisplay(raw);
      const expected = parts[parts.length - 1];
      if (r !== expected) {
        throw new Error(`expected basename "${expected}", got "${r}" from "${raw}"`);
      }
    }));

  test("property: never throws on arbitrary string input (robustness)", () =>
    hegel.test((tc) => {
      const garbage = tc.draw(gs.sampledFrom([
        "", "[[", "]]", "[[]]", "[[|]]", "[[a|]]", "[[|b]]",
        "no brackets", "[[multiple]] [[wikilinks]]", "[[a]]b[[c]]",
        "\n", "🦄", "[[unicode/café|é]]",
      ]));
      const r = extractLinkDisplay(garbage); // must not throw
      if (typeof r !== "string") throw new Error(`non-string output: ${typeof r}`);
    }));

  test("property: idempotent on already-extracted display strings", () =>
    hegel.test((tc) => {
      // If the input is a plain word (no brackets), extracting twice equals
      // extracting once: the function passes plain text through unchanged.
      const word = tc.draw(gs.sampledFrom(["foo", "WSCAD AG", "two words", "a-b-c"]));
      const once = extractLinkDisplay(word);
      const twice = extractLinkDisplay(once);
      if (once !== twice) throw new Error(`not idempotent on "${word}": once="${once}", twice="${twice}"`);
    }));
});
