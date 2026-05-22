/**
 * Pure wikilink display-text extraction.
 *
 * Extracted from formatValueForChip's LinkValue branch. Given a raw
 * wikilink string (the output of LinkValue.toString()), return the text
 * to display in a chip:
 *
 *   - `[[Foo]]`              → "Foo"
 *   - `[[a/b/Foo]]`          → "Foo"     (basename of the target)
 *   - `[[a/b/Foo|Display]]`  → "Display" (alias takes priority)
 *   - non-wikilink garbage   → the input unchanged (caller's fallback)
 *
 * The regex deliberately rejects pipes and brackets in the target — a
 * wikilink with multiple `|` or unclosed brackets falls through to the
 * raw-input path. Tests pin both behaviors.
 */

const WIKILINK_RE = /^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/;

export function extractLinkDisplay(raw: string): string {
  const match = raw.match(WIKILINK_RE);
  if (!match) return raw;
  const target = match[1];
  const alias = match[2];
  if (alias) return alias;
  const slash = target.lastIndexOf("/");
  return slash >= 0 ? target.slice(slash + 1) : target;
}
