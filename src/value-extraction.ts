import { parseValue } from "./value-type";

// Helpers for extracting frontmatter values from a Bases entry.
//
// Bases sends property values as wrapper objects on a `BasesEntry`. Three rules:
//   1. Always go through `entry.getValue(propertyId)` — never read frontmatter directly.
//   2. Check for `NullValue` / empty before reading. Bases returns a sentinel
//      object for missing properties, not undefined.
//   3. Call `.toString()` to coerce wrapper objects (Literal, LinkValue, DateValue, etc.).
//
// The empty-string fallback is intentional — callers decide how to handle missing data.

/** Returns true if `value` is null, undefined, NullValue, or an empty string. */
export function isValueEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.length === 0) return true;
  if (typeof value === "object" && value !== null) {
    // Bases' documented missing-field sentinel — checked by name to avoid
    // importing obsidian types we may not have in scope.
    if (value.constructor?.name === "NullValue") return true;
    // Catch-all for NullValue-like wrappers without a recognizable constructor.
    // Bases has at least two shapes for "missing field":
    //   - one whose toString() returns ""   (the classic NullValue)
    //   - one whose toString() returns "null" — a sentinel { icon: "lucide-file-question" }
    //     with isTruthy()=>false, used when Bases knows a field is absent for an
    //     entry but the property is registered in the view.
    // Both must be filtered before detectValueType — otherwise a 313-row pool
    // with one such sentinel gets isNumericValue(false) on it, allNumeric flips
    // false, and the axis type collapses to "string" (which then bypasses the
    // numeric-userOverrode shortcut in resolveBounds → bounds default to data-
    // derived → axis labels render with FP-imprecise endpoints).
    //
    // We deliberately do NOT key on isTruthy() alone — a Literal wrapping 0,
    // false, or "" all have isTruthy()===false but represent real values, not
    // missing data. Discriminating by toString() keeps Literal{0}→"0",
    // Literal{false}→"false" passing through as real values.
    const toString = (value as { toString?: () => string }).toString;
    if (typeof toString === "function") {
      const s = toString.call(value);
      if (s === "" || s === "null") return true;
    }
  }
  return false;
}

/**
 * Read a property as a finite number. Tries the canonical numeric path
 * first (covers `Number(v)` cases). Falls through to time strings (MM:SS,
 * HH:MM:SS → seconds) and ISO dates (YYYY-MM-DD → ms timestamp). Returns
 * null on missing/empty/unparseable. See ./value-type for the parsers —
 * we go through them so that any axis or color column gets the same
 * detect/parse pipeline.
 */
export function extractNumber(entry: unknown, propertyId: string | null | undefined): number | null {
  if (!propertyId) return null;
  try {
    const value = (entry as { getValue: (id: string) => unknown }).getValue(propertyId);
    if (isValueEmpty(value)) return null;
    const num = parseValue(value, "numeric");
    if (num !== null) return num;
    const time = parseValue(value, "time");
    if (time !== null) return time;
    const date = parseValue(value, "date");
    if (date !== null) return date;
    return null;
  } catch {
    return null;
  }
}

/** Read a property as a string. Returns null on missing/empty. */
export function extractString(entry: unknown, propertyId: string | null | undefined): string | null {
  if (!propertyId) return null;
  try {
    const value = (entry as { getValue: (id: string) => unknown }).getValue(propertyId);
    if (isValueEmpty(value)) return null;
    return String(value);
  } catch {
    return null;
  }
}

/**
 * Strip `note.` prefix from a Bases property id to get the bare frontmatter key.
 * Bases stores ids as `note.priority` etc.; the actual frontmatter key is `priority`.
 */
export function propertyIdToKey(propertyId: string): string {
  if (propertyId.startsWith("note.")) return propertyId.slice(5);
  return propertyId;
}
