/**
 * Unified value-type layer — detect, parse, and format the three first-class
 * value types every axis / color axis can carry:
 *
 *   numeric  -  31.7, "5.5", 100
 *   time     -  "5:45" (MM:SS), "3:42:15" (HH:MM:SS)
 *   date     -  "2024-06-15" (ISO YYYY-MM-DD prefix)
 *   string   -  fallback / categorical / mixed
 *
 * Canonical internal representation: a `number`. For `time`, the canonical
 * unit is SECONDS (integer); a 5:45 pace is 345. Lossless round-trips for
 * any HMS string with seconds in [0, 59]. For `date`, the canonical unit
 * is a JS millisecond timestamp.
 *
 * Why one module: previously each consumer (extractNumber, the gradient
 * parser, axis tick formatter, tooltip formatter) reinvented its own
 * coercion path. That meant adding time support would require touching
 * every site separately, and small inconsistencies could creep in (e.g.,
 * the gradient parses dates but the axis formatter doesn't). Centralizing
 * here gives every consumer the same detect/parse/format pipeline.
 */

export type ValueType = "numeric" | "time" | "date" | "string";

// ISO date prefix: YYYY-MM-DD (with optional time). We require the prefix
// so plain numeric strings ("1", "2024") don't get silently interpreted as
// dates by Date.parse's loose grammar.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// Time: M:SS, MM:SS, H:MM:SS, HH:MM:SS. We require seconds always 2-digit
// (industry-standard for run paces and stopwatch displays). Hours/minutes
// can be 1-2 digits; we validate range in parser.
const TIME_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;

export function detectValueType(values: readonly unknown[]): ValueType {
  if (values.length === 0) return "string";
  let allNumeric = true;
  let allTime = true;
  let allDate = true;
  let sawAny = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    sawAny = true;
    if (!isNumericValue(v)) allNumeric = false;
    if (!isTimeValue(v)) allTime = false;
    if (!isDateValue(v)) allDate = false;
    if (!allNumeric && !allTime && !allDate) break;
  }
  if (!sawAny) return "string";
  // Precedence: numeric > time > date. A pure number "5" should be
  // numeric, not accidentally time. The disjoint grammars (numeric has
  // no `:` or `-`; time has `:`; date has `-`) mean only one is true.
  if (allNumeric) return "numeric";
  if (allTime) return "time";
  if (allDate) return "date";
  return "string";
}

export function parseValue(v: unknown, type: ValueType): number | null {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "numeric":
      return parseNumeric(v);
    case "time":
      return parseTime(v);
    case "date":
      return parseDate(v);
    case "string":
      return null;
  }
}

export function formatValue(n: number, type: ValueType): string {
  switch (type) {
    case "numeric":
      // Downstream sites (axis ticks) apply their own precision via
      // formatTick; this is the bare default for tooltips etc.
      return String(n);
    case "time":
      return formatTime(n);
    case "date":
      return formatDate(n);
    case "string":
      return String(n);
  }
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Coerce an arbitrary value to a trimmed string for grammar-based parsing.
 * Bases hands us wrapper objects (TextValue, DateValue, etc.) for most
 * frontmatter values — those have useful toString() but aren't `typeof
 * === "string"`. We accept any non-null object's String() coercion so the
 * wrapper case works the same as a primitive.
 *
 * Returns null for null/undefined/empty so all callers can early-out the
 * same way.
 */
function toScanString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "object") {
    const t = String(v).trim();
    return t === "" ? null : t;
  }
  return null;
}

function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  const s = toScanString(v);
  if (s === null) return false;
  return Number.isFinite(Number(s));
}

function isTimeValue(v: unknown): boolean {
  return parseTime(v) !== null;
}

function isDateValue(v: unknown): boolean {
  // JS Date object (e.g., YAML auto-parses unquoted `date: 2025-01-05` to a
  // Date instance via Obsidian's parser, and Bases hands us DateValue
  // wrappers whose toString is the ISO string).
  if (v instanceof Date) return Number.isFinite(v.getTime());
  const s = toScanString(v);
  if (s === null) return false;
  if (!ISO_DATE_RE.test(s)) return false;
  return Number.isFinite(Date.parse(s));
}

function parseNumeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = toScanString(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTime(v: unknown): number | null {
  const s = toScanString(v);
  if (s === null) return null;
  const m = TIME_RE.exec(s);
  if (!m) return null;
  const hours = m[1] !== undefined ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  if (seconds >= 60) return null;
  // For HH:MM:SS the minutes field is constrained to <60 (else the input
  // is ambiguous between "70 minutes" and "1h10m"). For MM:SS the
  // minutes can be anything; the regex's max of 99 is enforced by {1,2}.
  if (m[1] !== undefined && minutes >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseDate(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const s = toScanString(v);
  if (s === null) return null;
  if (!ISO_DATE_RE.test(s)) return null;
  const ts = Date.parse(s);
  return Number.isFinite(ts) ? ts : null;
}

function formatTime(secondsRaw: number): string {
  const total = Math.max(0, Math.round(secondsRaw));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    const mm = String(minutes).padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

function formatDate(timestamp: number): string {
  // Use UTC so the formatted date matches the parsed input regardless of
  // local timezone: "2024-06-15" parsed by Date.parse is 00:00 UTC, and
  // re-formatting via toISOString returns the same date string.
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
