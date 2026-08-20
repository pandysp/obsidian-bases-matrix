/**
 * Tests for list-controls — the pure order → control-allowlist mapping the
 * H1 list view renders from. The list is deliberately narrow: only
 * planned/done/area may appear, in the order the view config lists them.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { CONTROL_ALLOWLIST, visibleControls } from "../list-controls";

describe("visibleControls — concrete cases", () => {
  test("keeps allowlisted keys in view order", () => {
    expect(visibleControls(["note.done", "note.planned", "note.area"])).toEqual([
      "done",
      "planned",
      "area",
    ]);
  });

  test("ignores everything outside the allowlist", () => {
    expect(
      visibleControls(["note.urgency", "file.name", "note.done", "formula.quadrant"]),
    ).toEqual(["done"]);
  });

  test("accepts bare keys without the note. prefix", () => {
    expect(visibleControls(["done", "area"])).toEqual(["done", "area"]);
  });

  test("empty order → no controls", () => {
    expect(visibleControls([])).toEqual([]);
  });

  test("title can never appear — it is not a property anymore", () => {
    expect(visibleControls(["note.title", "title"])).toEqual([]);
  });
});

describe("visibleControls — properties", () => {
  test("property: output only ever contains allowlisted keys", () =>
    hegel.test((tc) => {
      const pool = [
        "note.done", "note.planned", "note.area", "note.urgency",
        "done", "planned", "area", "file.name", "formula.quadrant", "note.title",
      ];
      const n = tc.draw(gs.integers({ minValue: 0, maxValue: 8 }));
      const order: string[] = [];
      for (let i = 0; i < n; i++) order.push(tc.draw(gs.sampledFrom(pool)));
      const result = visibleControls(order);
      for (const key of result) {
        if (!(CONTROL_ALLOWLIST as readonly string[]).includes(key)) {
          throw new Error(`non-allowlisted key leaked: ${key}`);
        }
      }
      if (result.length > order.length) {
        throw new Error(`more controls (${result.length}) than order entries (${order.length})`);
      }
    }));
});
