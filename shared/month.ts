/** Mois au format "YYYY-MM", dates au format "YYYY-MM-DD" (calendrier local). */

export function isMonthKey(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + delta));
}

export function currentMonthKey(): string {
  return todayISO().slice(0, 7);
}

export function monthKeyFromDate(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Liste de `count` mois se terminant par `end` (inclus), du plus ancien au plus récent. */
export function monthRange(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(end, i - count + 1));
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Lundi = 0 … dimanche = 6 */
export function firstWeekdayOfMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d ?? 1);
}

const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const fmtMonthShort = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const fmtMonthOnly = new Intl.DateTimeFormat("fr-FR", { month: "long" });
const fmtDayLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtDayFull = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
const fmtDayShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "2026-10" → "Octobre 2026" */
export const monthLabel = (key: string) => cap(fmtMonth.format(parse(key + "-01")));
/** "2026-10" → "octobre" */
export const monthName = (key: string) => fmtMonthOnly.format(parse(key + "-01"));
/** "2026-10" → "oct." */
export const monthShort = (key: string) => fmtMonthShort.format(parse(key + "-01"));
/** "2026-10-03" → "Samedi 3 octobre" */
export const dayLabel = (iso: string) => cap(fmtDayLong.format(parse(iso)));
/** "2026-10-03" → "03 octobre 2026" */
export const dayFull = (iso: string) => fmtDayFull.format(parse(iso));
/** "2026-10-03" → "3 oct." */
export const dayShort = (iso: string) => fmtDayShort.format(parse(iso));
/** "2026-10-03" → "03/10/2026" */
export const dayFR = (iso: string) => iso.split("-").reverse().join("/");
