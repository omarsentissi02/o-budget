import type { Frequency } from "./income";

/** Calcul de dates en calendrier civil (« YYYY-MM-DD »), sans fuseau : aucune dérive due à l'heure d'été. */

const pad = (n: number) => String(n).padStart(2, "0");

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function fmtISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDaysISO(iso: string, delta: number): string {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return fmtISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Ajoute des mois en conservant le jour d'ancrage (31 → 30 ou 28 quand le mois est plus court). */
export function addMonthsISO(iso: string, months: number, anchorDay?: number): string {
  const { y, m, d } = parseISO(iso);
  const day = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmtISO(ny, nm, Math.min(day, lastDayOfMonth(ny, nm)));
}

export function diffDays(a: string, b: string): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Lundi = 0 … dimanche = 6 */
export function weekdayIndex(iso: string): number {
  const { y, m, d } = parseISO(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function startOfWeekISO(iso: string): string {
  return addDaysISO(iso, -weekdayIndex(iso));
}

/** Occurrence n (0 = ancre) d'une récurrence. `once` n'a qu'une occurrence. */
export function occurrence(anchor: string, frequency: Frequency, n: number): string {
  const { d } = parseISO(anchor);
  switch (frequency) {
    case "once":
      return anchor;
    case "weekly":
      return addDaysISO(anchor, 7 * n);
    case "monthly":
      return addMonthsISO(anchor, n, d);
    case "quarterly":
      return addMonthsISO(anchor, 3 * n, d);
    case "yearly":
      return addMonthsISO(anchor, 12 * n, d);
  }
}

/** Prochaine échéance STRICTEMENT après `date` (utilisé après un paiement pour avancer l'échéance). */
export function nextAfter(anchor: string, frequency: Frequency, date: string): string | null {
  if (frequency === "once") return null;
  for (let n = 0; n < 5000; n++) {
    const o = occurrence(anchor, frequency, n);
    if (o > date) return o;
  }
  return null;
}

/** Toutes les occurrences comprises entre `from` et `to` inclus (bornes ISO), à partir de l'ancre. */
export function occurrencesBetween(anchor: string, frequency: Frequency, from: string, to: string): string[] {
  const out: string[] = [];
  const max = frequency === "weekly" ? 5000 : 1200;
  for (let n = 0; n < max; n++) {
    const o = occurrence(anchor, frequency, n);
    if (o > to) break;
    if (o >= from) out.push(o);
    if (frequency === "once") break;
  }
  return out;
}

/** Coût mensualisé en centimes (entier arrondi). Hebdomadaire = 52/12 semaines par mois. */
export function monthlyEquivalentCents(amountCents: number, frequency: Frequency): number {
  switch (frequency) {
    case "once":
      return 0;
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "monthly":
      return amountCents;
    case "quarterly":
      return Math.round(amountCents / 3);
    case "yearly":
      return Math.round(amountCents / 12);
  }
}

/** Coût annuel en centimes (exact : pas de passage par la valeur mensualisée arrondie). */
export function yearlyEquivalentCents(amountCents: number, frequency: Frequency): number {
  switch (frequency) {
    case "once":
      return 0;
    case "weekly":
      return amountCents * 52;
    case "monthly":
      return amountCents * 12;
    case "quarterly":
      return amountCents * 4;
    case "yearly":
      return amountCents;
  }
}
