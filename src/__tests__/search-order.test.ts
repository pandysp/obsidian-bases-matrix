/**
 * Tests for search-order helpers: append the configured title property to
 * Bases' search order list when it isn't already there, idempotently and
 * by reference-equality (so callers can skip setOrder when no change).
 *
 * The matrix view's `ensureTitleSearchable()` glues these pure helpers to a
 * mutable Bases config object. Tests here cover the algorithmic core.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { appendUniqueToOrder, orderNeedsAppend } from "../search-order";

describe("appendUniqueToOrder", () => {
  test("absent title property leaves order untouched (same reference)", () => {
    const order = ["file.name"] as const;
    const out = appendUniqueToOrder(order, null);
    expect(out).toBe(order); // referential equality — caller can skip setOrder
    expect(orderNeedsAppend(order, null)).toBe(false);
  });

  test("empty-string title property leaves order untouched", () => {
    const order = ["file.name"] as const;
    expect(appendUniqueToOrder(order, "")).toBe(order);
    expect(orderNeedsAppend(order, "")).toBe(false);
  });

  test("new title property is appended exactly once", () => {
    const out = appendUniqueToOrder(["file.name"], "note.title");
    expect(out).toEqual(["file.name", "note.title"]);
  });

  test("already-present title property leaves order untouched (same reference)", () => {
    const order = ["file.name", "note.title"] as const;
    const out = appendUniqueToOrder(order, "note.title");
    expect(out).toBe(order); // no-op → same reference
    expect(orderNeedsAppend(order, "note.title")).toBe(false);
  });

  test("title property at the head of an existing order is detected", () => {
    // Regression guard: a naive `currentOrder[currentOrder.length - 1] === id`
    // check would miss this. `.includes()` handles any position.
    const order = ["note.title", "file.name"] as const;
    expect(orderNeedsAppend(order, "note.title")).toBe(false);
    expect(appendUniqueToOrder(order, "note.title")).toBe(order);
  });

  test("property: result always contains the title property when it's set", () =>
    hegel.test((tc) => {
      const orderLen = tc.draw(gs.integers({ minValue: 0, maxValue: 6 }));
      const order: string[] = [];
      for (let i = 0; i < orderLen; i++) {
        order.push(tc.draw(gs.sampledFrom(["file.name", "note.area", "note.priority", "file.mtime"])));
      }
      const titleProp = tc.draw(gs.sampledFrom(["note.title", "note.headline", "note.area"]));
      const out = appendUniqueToOrder(order, titleProp);
      if (!out.includes(titleProp)) {
        throw new Error(`title "${titleProp}" not in result ${JSON.stringify(out)}`);
      }
    }));

  test("property: idempotent — applying twice is the same as applying once", () =>
    hegel.test((tc) => {
      const orderLen = tc.draw(gs.integers({ minValue: 0, maxValue: 6 }));
      const order: string[] = [];
      for (let i = 0; i < orderLen; i++) {
        order.push(tc.draw(gs.sampledFrom(["file.name", "note.area", "note.priority", "file.mtime"])));
      }
      const titleProp = tc.draw(gs.sampledFrom(["note.title", "note.headline"]));
      const once = appendUniqueToOrder(order, titleProp);
      const twice = appendUniqueToOrder(once, titleProp);
      if (twice !== once) {
        throw new Error("non-idempotent: second call returned a new reference");
      }
    }));

  test("property: result preserves the original order's elements and ordering", () =>
    hegel.test((tc) => {
      const orderLen = tc.draw(gs.integers({ minValue: 0, maxValue: 6 }));
      const order: string[] = [];
      for (let i = 0; i < orderLen; i++) {
        order.push(`prop-${i}`);
      }
      const titleProp = tc.draw(gs.sampledFrom(["note.title", "prop-0", "prop-3"]));
      const out = appendUniqueToOrder(order, titleProp);
      let cursor = 0;
      for (const elem of order) {
        const found = out.indexOf(elem, cursor);
        if (found < 0) {
          throw new Error(`original element "${elem}" missing from output ${JSON.stringify(out)}`);
        }
        cursor = found + 1;
      }
    }));

  test("property: result length grows by 0 or 1, never more", () =>
    hegel.test((tc) => {
      const orderLen = tc.draw(gs.integers({ minValue: 0, maxValue: 6 }));
      const order: string[] = [];
      for (let i = 0; i < orderLen; i++) {
        order.push(tc.draw(gs.sampledFrom(["file.name", "note.area", "note.priority"])));
      }
      const titleProp = tc.draw(gs.sampledFrom([null, "", "note.title", "file.name"]));
      const out = appendUniqueToOrder(order, titleProp);
      const delta = out.length - order.length;
      if (delta !== 0 && delta !== 1) {
        throw new Error(`length grew by ${delta} (expected 0 or 1)`);
      }
    }));
});

describe("orderNeedsAppend", () => {
  test("property: agrees with appendUniqueToOrder's reference-equality contract", () =>
    hegel.test((tc) => {
      const orderLen = tc.draw(gs.integers({ minValue: 0, maxValue: 6 }));
      const order: string[] = [];
      for (let i = 0; i < orderLen; i++) {
        order.push(tc.draw(gs.sampledFrom(["file.name", "note.area"])));
      }
      const titleProp = tc.draw(gs.sampledFrom([null, "", "note.title", "file.name", "note.area"]));
      const needs = orderNeedsAppend(order, titleProp);
      const result = appendUniqueToOrder(order, titleProp);
      if (needs && result === order) {
        throw new Error(`needs=true but result is same reference (no append happened)`);
      }
      if (!needs && result !== order) {
        throw new Error(`needs=false but result is a different reference (append happened anyway)`);
      }
    }));
});
