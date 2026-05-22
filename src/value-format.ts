import { DateValue, LinkValue, ListValue, NullValue } from "obsidian";
import { extractLinkDisplay } from "./link-display";

/**
 * Format a Bases `Value` for chip display, mirroring base-board's behavior
 * so the two views render the same property identically.
 *
 *   - DateValue   → relative ("3 days ago")
 *   - LinkValue   → display text from `[[target|display]]`, or target alone
 *   - ListValue   → comma-joined recursive format
 *   - everything else → toString()
 *
 * The wikilink parsing for LinkValue lives in ./link-display so the
 * regex-edge-case behavior is unit-testable without Obsidian classes.
 */
export function formatValueForChip(val: unknown): string {
  if (val == null) return "";
  if (val instanceof DateValue) {
    return val.relative();
  }
  if (val instanceof LinkValue) {
    return extractLinkDisplay(val.toString());
  }
  if (val instanceof ListValue) {
    const parts: string[] = [];
    for (let i = 0; i < val.length(); i++) {
      const item = val.get(i);
      if (!item || item instanceof NullValue || !item.isTruthy()) continue;
      parts.push(formatValueForChip(item));
    }
    return parts.join(", ");
  }
  // Fallback: any other Value type has toString(); plain JS values toString too.
  return String(val);
}
