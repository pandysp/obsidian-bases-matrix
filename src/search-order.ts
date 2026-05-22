/**
 * Pure helpers for Bases' search-scope `order` array.
 *
 * Bases' toolbar Search filters via `applySearchQuery(entries, view.config.getOrder())`
 * — the search scope is the property IDs returned by `getOrder()`. Matrix
 * doesn't naturally use columns, so the order list defaults to `["file.name"]`
 * which is the file's BASENAME, not the user-facing frontmatter title.
 * Extracting the configured title property into the order list lets Bases'
 * built-in search hit the readable title.
 *
 * This module owns the *order-array math*; the matrix-view glues it to Bases'
 * mutable config object.
 */

/**
 * Append `propertyId` to `currentOrder` unless it's already present, returning
 * the resulting array. Returns the SAME reference as `currentOrder` when no
 * append is needed — callers can use referential equality to skip a `setOrder`
 * call when nothing changed.
 *
 * If `propertyId` is null/undefined/empty, returns `currentOrder` unchanged
 * (callers shouldn't have to guard the title-missing case).
 */
export function appendUniqueToOrder(
  currentOrder: readonly string[],
  propertyId: string | null | undefined,
): readonly string[] {
  if (!propertyId) return currentOrder;
  if (currentOrder.includes(propertyId)) return currentOrder;
  return [...currentOrder, propertyId];
}

/** True when `appendUniqueToOrder` would actually mutate the order. */
export function orderNeedsAppend(
  currentOrder: readonly string[],
  propertyId: string | null | undefined,
): boolean {
  if (!propertyId) return false;
  return !currentOrder.includes(propertyId);
}
