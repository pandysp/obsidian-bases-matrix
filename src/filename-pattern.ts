/**
 * Resolves the optional `newItemFilenamePattern` view config into a concrete
 * basename for new files created via Bases' "+New" toolbar button.
 *
 * Why this exists: Obsidian Bases defaults to `Untitled.md` for new files,
 * with " 1", " 2", … collision counters. That's fine for many workflows but
 * unhelpful when a folder uses a stable identifier convention (issue
 * trackers, Zettelkasten, daily logs). This helper lets users opt into a
 * pattern via their `.base` file without writing plugin code.
 *
 * Scope is intentionally narrow for v1: only the `{N}` token is supported.
 * `{TITLE}`, `{DATE}` etc. are deferred until someone actually asks — every
 * shipped token is a forever commitment, and the YAGNI cost of starting
 * small is low.
 *
 * Pure module — no Obsidian / Vault dependencies. The caller is responsible
 * for enumerating the target folder's contents and passing basenames in.
 * Keeps property-based tests easy.
 */

const N_TOKEN = "{N}";

// Hardcoded regex — matches a string consisting of one or more ASCII digits.
// Used to validate the "middle" segment between a pattern's prefix and
// suffix is a non-negative integer.
const DIGITS_ONLY = /^\d+$/;

/**
 * Resolve a filename pattern to a concrete basename.
 *
 * Supported tokens:
 *   {N}  — next integer that makes the resulting basename unique in the
 *          target folder. Computed by scanning `existingBasenames`
 *          (basenames without the `.md` extension) for files whose names
 *          fit the pattern's prefix + digits + suffix shape. Starts at 1
 *          when no existing file matches.
 *
 * Behavior:
 *   - Undefined / empty / whitespace-only pattern → null (caller falls
 *     back to Obsidian native behavior).
 *   - Pattern with no `{N}` → returned verbatim. Bases' built-in
 *     collision counter handles uniqueness.
 *   - Pattern with one `{N}` → integer substitution.
 *   - Pattern with multiple `{N}` → null (ambiguous; caller falls back).
 *   - Prefix/suffix may contain any characters (no regex involvement;
 *     plain string comparison via startsWith / endsWith).
 */
export function resolveFilenamePattern(
  pattern: string | undefined,
  existingBasenames: string[],
): string | null {
  if (!pattern || !pattern.trim()) return null;

  const firstIdx = pattern.indexOf(N_TOKEN);
  if (firstIdx === -1) return pattern;
  const secondIdx = pattern.indexOf(N_TOKEN, firstIdx + N_TOKEN.length);
  if (secondIdx !== -1) return null;

  const prefix = pattern.slice(0, firstIdx);
  const suffix = pattern.slice(firstIdx + N_TOKEN.length);

  let maxN = 0;
  let foundAny = false;
  for (const name of existingBasenames) {
    if (name.length < prefix.length + suffix.length) continue;
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const middle = name.slice(prefix.length, name.length - suffix.length);
    if (!DIGITS_ONLY.test(middle)) continue;
    const n = parseInt(middle, 10);
    foundAny = true;
    if (n > maxN) maxN = n;
  }

  const nextN = foundAny ? maxN + 1 : 1;
  return prefix + String(nextN) + suffix;
}
