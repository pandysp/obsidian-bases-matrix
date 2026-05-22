/**
 * Tests for value-extraction helpers: isValueEmpty, extractNumber, extractString,
 * resolveTitle, propertyIdToKey.
 *
 * These wrap how Bases hands data to the plugin — NullValue sentinels,
 * `note.*` property-id prefixes, missing fields, finite-only numbers.
 * Bugs hit here showed up as wrong tooltips ("Untitled" for valid notes) and
 * silent drops ("Infinity in y → point disappears").
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  isValueEmpty,
  extractNumber,
  extractString,
  resolveTitle,
  propertyIdToKey,
} from "../value-extraction";

/** Stand-in for a Bases entry that returns canned values from `getValue()`. */
function fakeEntry(values: Record<string, unknown>, basename = "untitled") {
  return {
    file: { basename },
    getValue: (id: string) => values[id],
  };
}

/** Constructor-name sentinel that mirrors Bases' `NullValue`. */
class NullValue {
  isTruthy(): boolean { return false; }
  toString(): string { return ""; }
}

describe("isValueEmpty", () => {
  test("null and undefined are empty", () => {
    expect(isValueEmpty(null)).toBe(true);
    expect(isValueEmpty(undefined)).toBe(true);
  });

  test("empty string is empty; non-empty string isn't", () => {
    expect(isValueEmpty("")).toBe(true);
    expect(isValueEmpty(" ")).toBe(false); // a space is NOT empty (deliberate)
    expect(isValueEmpty("foo")).toBe(false);
  });

  test("NullValue (by constructor name) is empty", () => {
    expect(isValueEmpty(new NullValue())).toBe(true);
  });

  test("sentinel wrapper (toString() === '') is empty", () => {
    // NullValue-shape without a recognizable constructor name. Still empty
    // because its toString() yields "". This is what Bases hands us for
    // missing-field cases when its NullValue class is unreachable by name.
    expect(isValueEmpty({ toString: () => "" })).toBe(true);
    expect(isValueEmpty({ isTruthy: () => false, toString: () => "" })).toBe(true);
  });

  // Regression: Bases has a second missing-field sentinel — a wrapper with
  // `icon: "lucide-file-question"` whose toString() returns "null" (the
  // string, not the primitive). It's what Bases hands us when a property is
  // registered for the view but absent on a particular entry. Without this
  // check, the sentinel slips through isValueEmpty, gets fed to
  // detectValueType, fails isNumericValue (Number("null") = NaN), and forces
  // the axis type to "string" — bypassing the numeric-userOverrode shortcut
  // in resolveBounds. Discovered via CDP inspection of live Obsidian state
  // when the matrix view's bounds weren't being honored.
  test("question-mark sentinel wrapper (toString() === 'null') is empty", () => {
    const sentinel = {
      icon: "lucide-file-question",
      isTruthy: () => false,
      toString: () => "null",
    };
    expect(isValueEmpty(sentinel)).toBe(true);
  });

  // Regression: radar template defaults are x:0, y:0. Bases wraps them as
  // Literal-like objects whose isTruthy() returns false (0 is JS-falsy),
  // even though they represent real coordinates. The earlier implementation
  // keyed on isTruthy() and filtered these as missing, causing new + New
  // items to fall off the radar. Discriminate via toString() instead:
  // Literal{0}→"0", Literal{false}→"false", NullValue→"".
  test("Literal-style wrapper of numeric 0 is NOT empty", () => {
    expect(isValueEmpty({ isTruthy: () => false, toString: () => "0" })).toBe(false);
  });

  test("Literal-style wrapper of boolean false is NOT empty", () => {
    expect(isValueEmpty({ isTruthy: () => false, toString: () => "false" })).toBe(false);
  });

  test("primitive 0 and false are NOT empty", () => {
    expect(isValueEmpty(0)).toBe(false);
    expect(isValueEmpty(false)).toBe(false);
  });

  test("plain object without toString override is NOT empty", () => {
    // `{}` inherits Object.prototype.toString → "[object Object]", not "".
    // No constructor.name match, no toString match → not empty. Sensible
    // default: an unknown wrapper shape is assumed to hold a value until
    // proven empty.
    expect(isValueEmpty({})).toBe(false);
    expect(isValueEmpty({ isTruthy: () => true })).toBe(false);
  });

  test("property: extractString and extractNumber agree with isValueEmpty for missing data", () =>
    hegel.test((tc) => {
      const useNull = tc.draw(gs.booleans());
      const value = useNull ? new NullValue() : tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const entry = fakeEntry({ "note.x": value });
      const empty = isValueEmpty(value);
      const num = extractNumber(entry, "note.x");
      const str = extractString(entry, "note.x");
      if (empty) {
        if (num !== null || str !== null) {
          throw new Error(`isValueEmpty=true but extractors returned non-null (num=${num}, str=${str})`);
        }
      }
    }));
});

describe("extractNumber — time / date string passthrough", () => {
  // The extractor was extended (May 2026) to accept time strings (MM:SS,
  // HH:MM:SS) and ISO date strings, returning canonical seconds and
  // millisecond timestamps respectively. The fix ensures axis-plotting
  // works for `pace: "5:45"` and `date: "2025-06-15"` columns without
  // each caller having to re-parse.

  test("MM:SS string returns total seconds", () => {
    const e = fakeEntry({ "note.pace": "5:45" });
    expect(extractNumber(e, "note.pace")).toBe(5 * 60 + 45);
  });

  test("HH:MM:SS string returns total seconds (marathon range)", () => {
    const e = fakeEntry({ "note.split": "3:42:15" });
    expect(extractNumber(e, "note.split")).toBe(3 * 3600 + 42 * 60 + 15);
  });

  test("ISO date string returns ms timestamp", () => {
    const e = fakeEntry({ "note.date": "2024-06-15" });
    const ts = extractNumber(e, "note.date");
    expect(ts).toBe(Date.parse("2024-06-15"));
  });

  test("plain numbers still take the numeric path (not interpreted as time/date)", () => {
    // Regression: "5" alone is a number, not a date year — confirms the
    // numeric path runs before the time / date paths in extractNumber.
    expect(extractNumber(fakeEntry({ "note.x": "5" }), "note.x")).toBe(5);
    expect(extractNumber(fakeEntry({ "note.x": "2024" }), "note.x")).toBe(2024);
  });

  test("Bases-style wrapper object (toString-able) parses through every type", () => {
    // The bug that masked all training-log points: Bases returns wrapper
    // objects whose typeof is "object". The old extractor coerced via
    // `String(value)` and worked; the value-type rewrite initially only
    // accepted primitives. Re-add toScanString coverage here so a
    // future refactor can't silently regress it.
    const wrap = (s: string) => ({ toString: () => s });
    expect(extractNumber(fakeEntry({ "note.x": wrap("5:45") }), "note.x"))
      .toBe(5 * 60 + 45);
    expect(extractNumber(fakeEntry({ "note.x": wrap("2024-06-15") }), "note.x"))
      .toBe(Date.parse("2024-06-15"));
    expect(extractNumber(fakeEntry({ "note.x": wrap("31.7") }), "note.x"))
      .toBe(31.7);
  });

  test("unparseable string returns null (not a silent zero)", () => {
    expect(extractNumber(fakeEntry({ "note.x": "hello" }), "note.x")).toBeNull();
    expect(extractNumber(fakeEntry({ "note.x": "5:99" }), "note.x")).toBeNull(); // seconds >= 60
  });
});

describe("extractNumber rejects non-finite", () => {
  test("infinity and NaN return null, not the value", () => {
    const e = fakeEntry({ "note.x": Infinity });
    expect(extractNumber(e, "note.x")).toBeNull();
    const e2 = fakeEntry({ "note.x": NaN });
    expect(extractNumber(e2, "note.x")).toBeNull();
  });

  test("property: any finite number round-trips through extractNumber", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const e = fakeEntry({ "note.x": n });
      const out = extractNumber(e, "note.x");
      if (out !== n) throw new Error(`expected ${n}, got ${out}`);
    }));

  test("property: numeric strings parse identically to numbers", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const eStr = fakeEntry({ "note.x": String(n) });
      const eNum = fakeEntry({ "note.x": n });
      if (extractNumber(eStr, "note.x") !== extractNumber(eNum, "note.x")) {
        throw new Error(`string vs number coercion divergence at ${n}`);
      }
    }));

  test("missing propertyId argument always returns null (no exception)", () => {
    const e = fakeEntry({ "note.x": 5 });
    expect(extractNumber(e, null)).toBeNull();
    expect(extractNumber(e, undefined)).toBeNull();
    expect(extractNumber(e, "")).toBeNull();
  });
});

describe("propertyIdToKey", () => {
  test("strips the 'note.' prefix exactly once", () => {
    expect(propertyIdToKey("note.priority")).toBe("priority");
  });

  test("leaves non-prefixed ids alone", () => {
    expect(propertyIdToKey("priority")).toBe("priority");
    expect(propertyIdToKey("file.ctime")).toBe("file.ctime"); // file.* is its own scope
  });

  test("does NOT strip 'note.' from the middle of the string", () => {
    expect(propertyIdToKey("frontmatter.note.foo")).toBe("frontmatter.note.foo");
  });

  // Idempotence holds for inputs Bases actually sends ("note.X" with no
  // recursive note. prefix). It does NOT hold for the synthetic "note.note.X"
  // because the function strips exactly one prefix per call by design — a
  // property test surfaced this and it's worth locking down explicitly so a
  // future "fix" doesn't accidentally make `note.` stripping greedy.
  test("idempotence: applying twice equals applying once for realistic Bases ids", () =>
    hegel.test((tc) => {
      const id = tc.draw(gs.sampledFrom([
        "note.priority", "note.area", "priority", "file.mtime", "file.ctime", "tags", "",
      ]));
      const once = propertyIdToKey(id);
      const twice = propertyIdToKey(once);
      if (once !== twice) throw new Error(`not idempotent for "${id}": once=${once} twice=${twice}`);
    }));

  test("strips exactly ONE 'note.' prefix per call (not greedy)", () => {
    // Documents the surfaced behavior. If you ever want greedy stripping,
    // change both this test and the implementation deliberately.
    expect(propertyIdToKey("note.note.weird")).toBe("note.weird");
    expect(propertyIdToKey(propertyIdToKey("note.note.weird"))).toBe("weird");
  });
});

describe("resolveTitle", () => {
  test("uses the configured title property when set", () => {
    const e = fakeEntry({ "note.title": "Real Task Title" }, "TODO-105");
    expect(resolveTitle(e, "note.title")).toBe("Real Task Title");
  });

  test("falls back to file basename when title is missing", () => {
    const e = fakeEntry({}, "TODO-105");
    expect(resolveTitle(e, "note.title")).toBe("TODO-105");
  });

  test("falls back to file basename when title is NullValue", () => {
    const e = fakeEntry({ "note.title": new NullValue() }, "TODO-105");
    expect(resolveTitle(e, "note.title")).toBe("TODO-105");
  });

  test("falls back to 'Untitled' when both title and basename are missing", () => {
    const e = { getValue: () => undefined } as unknown as { file?: { basename?: string } };
    expect(resolveTitle(e, "note.title")).toBe("Untitled");
  });

  test("property: an entry with a non-empty title never returns the basename", () =>
    hegel.test((tc) => {
      const title = tc.draw(gs.sampledFrom([
        "Pick up groceries", "Crypto research", "Q3 review", "x", "Multi word title",
      ]));
      const basename = tc.draw(gs.sampledFrom(["TODO-1", "TODO-105", "untitled"]));
      const e = fakeEntry({ "note.title": title }, basename);
      const got = resolveTitle(e, "note.title");
      if (got !== title) throw new Error(`expected "${title}", got "${got}"`);
    }));
});
