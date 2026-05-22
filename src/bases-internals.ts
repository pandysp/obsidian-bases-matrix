/**
 * Single typed surface for Obsidian Bases' private (non-typed) config + data
 * APIs. The Bases types Obsidian ships don't expose `get`/`set`/`getOrder`/
 * `setOrder` etc., but the runtime objects support them. Centralizing the
 * shape here means callers can cast once via `asBasesConfig(this.config)`
 * instead of inlining ad-hoc `(this.config as any)` everywhere.
 *
 * If Obsidian's public types grow to include these methods, deleting this
 * file becomes a one-import replacement at each call site.
 */

/** Runtime shape of the Bases view config used by this plugin. */
export interface BasesConfigRuntime {
  /** Read any config value by key. Returns the raw stored value (could be a
   *  string, number, boolean, or property-wrapper object). */
  get?: (key: string) => unknown;
  /** Write a config value. Persists to the `.base` file via Bases. */
  set?: (key: string, value: unknown) => void;
  /** Read the ordered list of property IDs Bases knows about for this view.
   *  Used as the search scope (`applySearchQuery(entries, getOrder())`). */
  getOrder?: () => string[];
  /** Write the order list. Distinct from `set("order", ...)` — those write
   *  to different fields on the config object. */
  setOrder?: (value: string[]) => void;
  /** Extract the canonical "note.X" / "file.X" / "formula.X" string from a
   *  property-type config value (which is stored as an object, not a string). */
  getAsPropertyId?: (key: string) => string | null;
  /** Human-readable display name configured for a property ID. */
  getDisplayName?: (propId: string) => string;
}

/** Runtime shape of `this.data` on a BasesView. */
export interface BasesDataRuntime {
  data?: unknown[];
}

/** Runtime shape of `this.queryController.query` on a BasesView.
 *  Carries top-level `.base` file directives (folder/template settings for
 *  new items, etc.) that the public Obsidian types don't expose. */
export interface BasesQueryRuntime {
  /** Folder for new items, configured via top-level `newItemFolder:` in the
   *  `.base` file. May be unset / empty. */
  newItemFolder?: string;
  /** Path to the template applied to new items, configured via top-level
   *  `newItemTemplate:` in the `.base` file. May be unset. */
  newItemTemplate?: string;
}

/** Cast a Bases view's `this.config` to the runtime shape we use. */
export function asBasesConfig(config: unknown): BasesConfigRuntime {
  return config as BasesConfigRuntime;
}

/** Cast a Bases view's `this.data` to the runtime shape we use. */
export function asBasesData(data: unknown): BasesDataRuntime {
  return data as BasesDataRuntime;
}

/** Cast `this.queryController.query` to the runtime shape we use. */
export function asBasesQuery(query: unknown): BasesQueryRuntime {
  return query as BasesQueryRuntime;
}
