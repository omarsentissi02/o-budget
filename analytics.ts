import { getCategory } from "./categories";
import { getPlatform, getSubcategory, NO_PLATFORM } from "./taxonomy";
import { addDaysISO, addMonthsISO, fmtISO, lastDayOfMonth, parseISO, startOfWeekISO } from "./recurrence";
import { percentChange } from "./finance";

/**
 * Analyses financières — fonctions pures sur des « lignes de dépense » (une ligne = un montant dans une
 * catégorie). Chaque ligne n'est comptée qu'UNE fois par dimension : pas de double comptage possible.
 * Les revenus pris en compte sont uniquement ceux REÇUS (cf. shared/income.ts).
 */

export interface TxLine {
  id: string;
  entryId: string;
  date: string;
  amountCents: number;
  categoryId: string;
  subcategoryId: string | null;
  subcategoryLabel?: string | null;
  merchantId: string | null;
  merchantLabel: string | null;
  platformId: string | null;
  paymentLabel: string;
  place: string | null;
  description: string | null;
}

export interface DatedAmount {
  date: string;
  amountCents: number;
}

export type Granularity = "day" | "week" | "month" | "year";

export function bucketKey(date: string, g: Granularity): string {
  switch (g) {
    case "day":
      return date;
    case "week":
      return startOfWeekISO(date);
    case "month":
      return date.slice(0, 7);
    case "year":
      return date.slice(0, 4);
  }
}

function nextBucket(key: string, g: Granularity): string {
  switch (g) {
    case "day":
      return addDaysISO(key, 1);
    case "week":
      return addDaysISO(key, 7);
    case "month":
      return addMonthsISO(`${key}-01`, 1).slice(0, 7);
    case "year":
      return String(Number(key) + 1);
  }
}

/** Toutes les clés de période entre `from` et `to` (dates ISO), y compris les périodes vides. */
export function bucketKeys(from: string, to: string, g: Granularity): string[] {
  const keys: string[] = [];
  const last = bucketKey(to, g);
  let k = bucketKey(from, g);
  for (let guard = 0; guard < 5000 && k <= last; guard++) {
    keys.push(k);
    k = nextBucket(k, g);
  }
  return keys;
}

export interface SeriesPoint {
  key: string;
  incomeCents: number;
  expenseCents: number;
  /** null quand l'épargne n'est pas connue à cette granularité (elle est saisie par mois). */
  savingsCents: number | null;
  netCents: number;
}

export function buildSeries(opts: {
  from: string;
  to: string;
  granularity: Granularity;
  expenses: DatedAmount[];
  receivedIncomes: DatedAmount[];
  /** épargne par mois « YYYY-MM » */
  savingsByMonth: Record<string, number>;
}): SeriesPoint[] {
  const { granularity: g } = opts;
  const keys = bucketKeys(opts.from, opts.to, g);
  const map = new Map<string, SeriesPoint>(
    keys.map((k) => [k, { key: k, incomeCents: 0, expenseCents: 0, savingsCents: g === "month" || g === "year" ? 0 : null, netCents: 0 }]),
  );
  for (const e of opts.expenses) {
    const p = map.get(bucketKey(e.date, g));
    if (p) p.expenseCents += e.amountCents;
  }
  for (const i of opts.receivedIncomes) {
    const p = map.get(bucketKey(i.date, g));
    if (p) p.incomeCents += i.amountCents;
  }
  if (g === "month" || g === "year") {
    for (const [month, cents] of Object.entries(opts.savingsByMonth)) {
      const p = map.get(bucketKey(`${month}-01`, g));
      if (p && p.savingsCents !== null) p.savingsCents += cents;
    }
  }
  for (const p of map.values()) p.netCents = p.incomeCents - p.expenseCents;
  return keys.map((k) => map.get(k) as SeriesPoint);
}

// --- Répartitions et exploration ----------------------------------------------------------------

export type Dimension = "category" | "subcategory" | "merchant" | "platform" | "payment" | "city";
export const DIMENSIONS: Dimension[] = ["category", "subcategory", "merchant", "platform", "payment", "city"];

export interface LineFilter {
  categoryId?: string;
  subcategoryId?: string;
  merchantId?: string;
  platformId?: string;
  paymentLabel?: string;
  place?: string;
}

const NONE_MERCHANT = "none";
const NONE_PLACE = "none";

export function dimensionKey(l: TxLine, d: Dimension): string {
  switch (d) {
    case "category":
      return l.categoryId;
    case "subcategory":
      return l.subcategoryId ?? `${l.categoryId}:none`;
    case "merchant":
      return l.merchantId ?? NONE_MERCHANT;
    case "platform":
      return l.platformId ?? NO_PLATFORM;
    case "payment":
      return l.paymentLabel;
    case "city":
      return l.place ?? NONE_PLACE;
  }
}

export function dimensionLabel(l: TxLine, d: Dimension): string {
  switch (d) {
    case "category":
      return getCategory(l.categoryId).label;
    case "subcategory":
      return getSubcategory(l.subcategoryId)?.label ?? l.subcategoryLabel ?? "Sans sous-catégorie";
    case "merchant":
      return l.merchantLabel ?? "Sans établissement";
    case "platform":
      return getPlatform(l.platformId)?.label ?? "Sans plateforme";
    case "payment":
      return l.paymentLabel;
    case "city":
      return l.place ?? "Lieu non précisé";
  }
}

export function matchesFilter(l: TxLine, f: LineFilter): boolean {
  if (f.categoryId !== undefined && l.categoryId !== f.categoryId) return false;
  if (f.subcategoryId !== undefined && (f.subcategoryId === "none" ? l.subcategoryId !== null : l.subcategoryId !== f.subcategoryId)) return false;
  if (f.merchantId !== undefined && (l.merchantId ?? NONE_MERCHANT) !== f.merchantId) return false;
  if (f.platformId !== undefined && (l.platformId ?? NO_PLATFORM) !== f.platformId) return false;
  if (f.paymentLabel !== undefined && l.paymentLabel !== f.paymentLabel) return false;
  if (f.place !== undefined && (l.place ?? NONE_PLACE) !== f.place) return false;
  return true;
}

export interface BreakdownRow {
  key: string;
  label: string;
  amountCents: number;
  count: number;
  /** part du total des lignes filtrées (0–100) */
  percent: number;
}

export function breakdown(lines: TxLine[], by: Dimension, filter: LineFilter = {}): { totalCents: number; rows: BreakdownRow[] } {
  const acc = new Map<string, BreakdownRow>();
  let total = 0;
  for (const l of lines) {
    if (!matchesFilter(l, filter)) continue;
    total += l.amountCents;
    const key = dimensionKey(l, by);
    const row = acc.get(key) ?? { key, label: dimensionLabel(l, by), amountCents: 0, count: 0, percent: 0 };
    row.amountCents += l.amountCents;
    row.count += 1;
    acc.set(key, row);
  }
  const rows = [...acc.values()].sort((a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label, "fr"));
  for (const r of rows) r.percent = total > 0 ? (r.amountCents / total) * 100 : 0;
  return { totalCents: total, rows };
}

export function filterLines(lines: TxLine[], filter: LineFilter): TxLine[] {
  return lines.filter((l) => matchesFilter(l, filter)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// --- Comparaison de périodes -----------------------------------------------------------------------

export interface PeriodTotals {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

export interface Comparison {
  current: PeriodTotals;
  previous: PeriodTotals;
  incomeChangePct: number | null;
  expenseChangePct: number | null;
  netChangePct: number | null;
}

export function compareTotals(current: PeriodTotals, previous: PeriodTotals): Comparison {
  return {
    current,
    previous,
    incomeChangePct: percentChange(previous.incomeCents, current.incomeCents),
    expenseChangePct: percentChange(previous.expenseCents, current.expenseCents),
    netChangePct: percentChange(previous.netCents, current.netCents),
  };
}

/** Période précédente de même durée, immédiatement avant `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / 86_400_000) + 1;
  return { from: addDaysISO(from, -days), to: addDaysISO(from, -1) };
}
function ymd(iso: string): [number, number, number] {
  const { y, m, d } = parseISO(iso);
  return [y, m - 1, d];
}

/** Bornes d'une période nommée autour d'une date : jour, semaine (lundi), mois ou année. */
export function periodRange(anchor: string, g: Granularity): { from: string; to: string } {
  const { y, m } = parseISO(anchor);
  switch (g) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = startOfWeekISO(anchor);
      return { from, to: addDaysISO(from, 6) };
    }
    case "month":
      return { from: fmtISO(y, m, 1), to: fmtISO(y, m, lastDayOfMonth(y, m)) };
    case "year":
      return { from: fmtISO(y, 1, 1), to: fmtISO(y, 12, 31) };
  }
}

// --- Détection de dépenses inhabituelles -----------------------------------------------------------

export type Unusual =
  | { kind: "line"; line: TxLine; thresholdCents: number; medianCents: number; reason: string }
  | { kind: "category"; categoryId: string; currentCents: number; averageCents: number; reason: string };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const UNUSUAL_RULES = {
  /** historique minimal (lignes) dans la catégorie pour juger une dépense */
  minHistory: 6,
  historyDays: 180,
  recentDays: 30,
  /** montant plancher : on ne signale pas un écart sur de petits montants */
  minLineCents: 2000,
  /** seuil = max(Q3 + 1,5×IQR, 2×médiane) */
  iqrFactor: 1.5,
  medianFactor: 2,
  categoryGrowth: 1.5,
  categoryMinDeltaCents: 4000,
};

export function detectUnusual(lines: TxLine[], today: string): Unusual[] {
  const R = UNUSUAL_RULES;
  const out: Unusual[] = [];
  const recentFrom = addDaysISO(today, -R.recentDays);
  const histFrom = addDaysISO(today, -R.historyDays);
  const byCat = new Map<string, TxLine[]>();
  for (const l of lines) {
    if (l.date < histFrom || l.date > today) continue;
    byCat.set(l.categoryId, [...(byCat.get(l.categoryId) ?? []), l]);
  }
  for (const [categoryId, list] of byCat) {
    for (const l of list) {
      if (l.date < recentFrom || l.amountCents < R.minLineCents) continue;
      const history = list.filter((x) => x.id !== l.id && x.date < recentFrom).map((x) => x.amountCents).sort((a, b) => a - b);
      if (history.length < R.minHistory) continue;
      const q1 = quantile(history, 0.25);
      const q3 = quantile(history, 0.75);
      const median = quantile(history, 0.5);
      const threshold = Math.max(q3 + R.iqrFactor * (q3 - q1), R.medianFactor * median);
      if (l.amountCents > threshold) {
        out.push({
          kind: "line",
          line: l,
          thresholdCents: Math.round(threshold),
          medianCents: Math.round(median),
          reason: `Montant nettement supérieur à vos dépenses habituelles dans « ${getCategory(categoryId).label} » (médiane ${(median / 100).toFixed(0)} €).`,
        });
      }
    }
  }
  // Dérive d'une catégorie : mois en cours (projeté au prorata) vs moyenne des 3 mois précédents.
  const month = today.slice(0, 7);
  const { d } = parseISO(today);
  const monthDays = lastDayOfMonth(...(month.split("-").map(Number) as [number, number]));
  const prevMonths = [1, 2, 3].map((k) => addMonthsISO(`${month}-01`, -k).slice(0, 7));
  const totals = new Map<string, Map<string, number>>();
  for (const l of lines) {
    const m = l.date.slice(0, 7);
    if (m !== month && !prevMonths.includes(m)) continue;
    const perMonth = totals.get(l.categoryId) ?? new Map<string, number>();
    perMonth.set(m, (perMonth.get(m) ?? 0) + l.amountCents);
    totals.set(l.categoryId, perMonth);
  }
  for (const [categoryId, perMonth] of totals) {
    if (categoryId === "logement" || categoryId === "assurance") continue;
    const past = prevMonths.map((m) => perMonth.get(m) ?? 0).filter((v) => v > 0);
    if (past.length < 2) continue;
    const average = past.reduce((s, v) => s + v, 0) / past.length;
    const current = perMonth.get(month) ?? 0;
    // On attend au moins 10 jours dans le mois et on compare le cumul réel (pas de projection hasardeuse).
    if (d < 10 || monthDays === 0) continue;
    if (current > average * R.categoryGrowth && current - average >= R.categoryMinDeltaCents) {
      out.push({
        kind: "category",
        categoryId,
        currentCents: current,
        averageCents: Math.round(average),
        reason: `« ${getCategory(categoryId).label} » dépasse déjà de ${Math.round(((current - average) / average) * 100)} % la moyenne des mois précédents.`,
      });
    }
  }
  return out;
}
