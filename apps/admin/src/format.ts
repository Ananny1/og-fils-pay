import { formatBhd, toFils } from "@filspay/money";

/**
 * The console's display helpers, kept in step with apps/web/src/format.ts so
 * staff and merchants see the same amounts and the same clock: Bahrain time,
 * 24-hour, "30 Oct 2026, 18:22". Never the browser's own locale or zone.
 */

/** Adds "," thousands grouping to a `formatBhd` string ("7326.913" →
 *  "7,326.913"). Pure string work on the formatter's output: still integer
 *  fils underneath, never a float. */
export function groupBhd(formatted: string): string {
  const negative = formatted.startsWith("-");
  const body = negative ? formatted.slice(1) : formatted;
  const [whole = "", frac] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}

/** A signed fils amount as "7,326.913 BHD". */
export function bhd(fils: number): string {
  return `${groupBhd(formatBhd(toFils(fils, { allowNegative: true })))} BHD`;
}

/** `—` for a null/absent value, so an empty table cell is visibly empty. */
export function dash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

const BAHRAIN_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bahrain",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const BAHRAIN_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bahrain",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const BAHRAIN_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bahrain",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** An instant in Bahrain time, e.g. "31 Aug 2026, 15:00". */
export function dateTime(iso: string | null | undefined): string {
  return iso ? BAHRAIN_DATE_TIME.format(new Date(iso)) : "—";
}

/** The Bahrain calendar day of an instant (or of a plain YYYY-MM-DD), e.g. "31 Aug 2026". */
export function date(value: string | null | undefined): string {
  if (!value) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+03:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : BAHRAIN_DATE.format(d);
}

/** Just the Bahrain wall-clock time of an instant, e.g. "18:27". */
export function time(iso: string | null | undefined): string {
  return iso ? BAHRAIN_TIME.format(new Date(iso)) : "—";
}

/** A business date (YYYY-MM-DD) as "Mon, 31 Aug 2026". No timezone shift:
 *  the date already is a Bahrain business day. */
export function businessDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const BAHRAIN_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bahrain",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's Bahrain calendar day as YYYY-MM-DD (what a `<input type="date">`
 *  holds), whatever zone the browser is in. The day flips at 21:00 UTC. */
export function bahrainToday(now: Date = new Date()): string {
  return BAHRAIN_YMD.format(now);
}

/** Bahrain is UTC+3 all year (no DST). */
const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;

/** An instant as a `<input type="datetime-local">` value in Bahrain wall
 *  time ("2026-10-30T18:00"), the same clock the console shows everywhere. */
export function bahrainInputValue(date: Date): string {
  return new Date(date.getTime() + BAHRAIN_OFFSET_MS).toISOString().slice(0, 16);
}

/** A `<input type="datetime-local">` value read as Bahrain time (not the
 *  browser's zone) → ISO instant, or null when it is empty or not a date.
 *  Same rule as apps/web/src/format.ts `localDateTimeToIso`. */
export function bahrainInputToIso(value: string): string | null {
  if (!value) return null;
  const withSeconds = /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  const parsed = new Date(`${withSeconds}+03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
