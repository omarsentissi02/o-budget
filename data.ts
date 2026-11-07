import type { DatedAmount, TxLine } from "../../shared/analytics";
import { computeMonthPosition, NON_VARIABLE_CATEGORIES, type DueItem, type MonthPosition } from "../../shared/budget";
import { fmtISO, lastDayOfMonth, occurrencesBetween } from "../../shared/recurrence";
import type { Frequency } from "../../shared/income";
import type { SubscriptionLike } from "../../shared/subscriptions";
import type { MonthSummaryDTO, SettingsDTO } from "../../shared/types";
import { getMonthSummary } from "./periods";

export const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: fmtISO(y, m, 1), to: fmtISO(y, m, lastDayOfMonth(y, m)) };
};

interface LineRow {
  id: string;
  entry_id: string;
  spent_on: string;
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
  sub_label: string | null;
  merchant_id: string | null;
  merchant_label: string | null;
  platform_id: string | null;
  payment_label: string;
  location_type: string;
  city: string | null;
  country_name: string;
  description: string | null;
}

/** Toutes les lignes de dépense entre deux dates ISO (incluses), pour l'utilisateur. */
export async function loadLines(db: D1Database, userId: string, from: string, to: string): Promise<TxLine[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.entry_id, e.spent_on, a.amount_cents, a.category_id, a.subcategory_id, s.label AS sub_label,
         a.merchant_id, a.merchant_label, a.platform_id, e.payment_label, e.location_type, e.city, e.country_name, e.description
       FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
       LEFT JOIN subcategories s ON s.id = a.subcategory_id
       WHERE e.user_id = ? AND e.spent_on BETWEEN ? AND ?`,
    )
    .bind(userId, from, to)
    .all<LineRow>();
  return results.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    date: r.spent_on,
    amountCents: r.amount_cents,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id,
    subcategoryLabel: r.sub_label,
    merchantId: r.merchant_id,
    merchantLabel: r.merchant_label,
    platformId: r.platform_id,
    paymentLabel: r.payment_label,
    place: r.location_type === "france" ? r.city : r.country_name,
    description: r.description,
  }));
}

/**
 * Revenus REÇUS (confirmés/terminés, versés à l'utilisateur) entre deux dates.
 * Date d'un revenu : date de réception ; à défaut date attendue ; à défaut 1er du mois de sa période.
 */
export async function loadReceivedIncomes(db: D1Database, userId: string, from: string, to: string): Promise<DatedAmount[]> {
  const { results } = await db
    .prepare(
      `SELECT i.amount_cents, COALESCE(i.received_on, d.expected_date, p.month || '-01') AS date
       FROM incomes i JOIN financial_periods p ON p.id = i.period_id
       LEFT JOIN income_details d ON d.income_id = i.id
       WHERE i.user_id = ? AND COALESCE(d.status, 'confirmed') IN ('confirmed', 'completed') AND COALESCE(d.paid_to, 'user') = 'user'
         AND p.month BETWEEN ? AND ?`,
    )
    .bind(userId, from.slice(0, 7), to.slice(0, 7))
    .all<{ amount_cents: number; date: string }>();
  return results.filter((r) => r.date >= from && r.date <= to).map((r) => ({ date: r.date, amountCents: r.amount_cents }));
}

export async function loadSavingsByMonth(db: D1Database, userId: string, fromMonth: string, toMonth: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT p.month, s.amount_cents FROM savings s JOIN financial_periods p ON p.id = s.period_id
       WHERE s.user_id = ? AND p.month BETWEEN ? AND ?`,
    )
    .bind(userId, fromMonth, toMonth)
    .all<{ month: string; amount_cents: number }>();
  return Object.fromEntries(results.map((r) => [r.month, r.amount_cents]));
}

export async function loadSubscriptionLikes(db: D1Database, userId: string): Promise<SubscriptionLike[]> {
  const { results } = await db
    .prepare("SELECT id, name, family, amount_cents, frequency, status, renewal_date FROM subscriptions WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; name: string; family: SubscriptionLike["family"]; amount_cents: number; frequency: Frequency; status: SubscriptionLike["status"]; renewal_date: string | null }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    family: r.family,
    amountCents: r.amount_cents,
    frequency: r.frequency,
    status: r.status,
    renewalDate: r.renewal_date,
  }));
}

/**
 * Échéances NON PAYÉES jusqu'à `toDate` (en retard incluses) : abonnements actifs + charges fixes.
 * Une échéance disparaît quand l'utilisateur la marque payée (la prochaine date est alors avancée).
 */
export async function loadDueItems(db: D1Database, userId: string, toDate: string): Promise<DueItem[]> {
  const [subs, rec] = await db.batch([
    db
      .prepare(
        `SELECT id, name, amount_cents, frequency, renewal_date, COALESCE(start_date, renewal_date) AS anchor
         FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trial') AND renewal_date IS NOT NULL AND renewal_date <= ?`,
      )
      .bind(userId, toDate),
    db
      .prepare(
        `SELECT id, label, amount_cents, frequency, next_due_date, anchor_date, end_date
         FROM recurring_items WHERE user_id = ? AND active = 1 AND next_due_date <= ?`,
      )
      .bind(userId, toDate),
  ]);
  const items: DueItem[] = [];
  for (const s of subs.results as { id: string; name: string; amount_cents: number; frequency: Frequency; renewal_date: string; anchor: string }[]) {
    // Première échéance (peut être en retard), puis les suivantes jusqu'à la date limite (abonnements hebdomadaires…).
    items.push({ id: s.id, label: s.name, amountCents: s.amount_cents, dueDate: s.renewal_date, kind: "subscription" });
    for (const d of occurrencesBetween(s.anchor, s.frequency, s.renewal_date, toDate)) {
      if (d !== s.renewal_date) items.push({ id: s.id, label: s.name, amountCents: s.amount_cents, dueDate: d, kind: "subscription" });
    }
  }
  for (const r of rec.results as { id: string; label: string; amount_cents: number; frequency: Frequency; next_due_date: string; anchor_date: string; end_date: string | null }[]) {
    const until = r.end_date && r.end_date < toDate ? r.end_date : toDate;
    items.push({ id: r.id, label: r.label, amountCents: r.amount_cents, dueDate: r.next_due_date, kind: "recurring" });
    for (const d of occurrencesBetween(r.anchor_date, r.frequency, r.next_due_date, until)) {
      if (d !== r.next_due_date) items.push({ id: r.id, label: r.label, amountCents: r.amount_cents, dueDate: d, kind: "recurring" });
    }
  }
  return items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export interface MonthFacts {
  summary: MonthSummaryDTO;
  position: MonthPosition;
  obligations: DueItem[];
}

export async function loadMonthFacts(db: D1Database, userId: string, month: string, settings: SettingsDTO, today: string): Promise<MonthFacts> {
  const { from, to } = monthBounds(month);
  const summary = await getMonthSummary(db, userId, month);
  const obligations = month < today.slice(0, 7) ? [] : await loadDueItems(db, userId, to);
  const marks = NON_VARIABLE_CATEGORIES.map(() => "?").join(",");
  const variable = await db
    .prepare(
      `SELECT COALESCE(SUM(a.amount_cents), 0) AS total FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
       WHERE e.user_id = ? AND e.spent_on BETWEEN ? AND ? AND a.category_id NOT IN (${marks})`,
    )
    .bind(userId, from, today < to ? (today < from ? from : today) : to, ...NON_VARIABLE_CATEGORIES)
    .first<{ total: number }>();
  const position = computeMonthPosition({
    month,
    today,
    receivedIncomeCents: summary.income.receivedCents,
    expectedIncomeCents: summary.income.expectedCents,
    expensesCents: summary.totals.expenseCents,
    savingsDoneCents: summary.savingsCents,
    savingsTargetCents: settings.monthlySavingsTargetCents,
    obligationsDueCents: obligations.reduce((s, o) => s + o.amountCents, 0),
    safetyReserveCents: settings.safetyReserveCents,
    variableExpensesCents: variable?.total ?? 0,
  });
  return { summary, position, obligations };
}

/** Solde du compte = solde de départ + (reçu − dépensé − épargné) depuis le mois de départ. null sans solde de départ. */
export async function loadAccountBalance(db: D1Database, userId: string, settings: SettingsDTO, today: string): Promise<number | null> {
  if (settings.openingBalanceCents === null || !settings.openingBalanceMonth) return null;
  const start = settings.openingBalanceMonth;
  const end = today.slice(0, 7);
  if (start > end) return settings.openingBalanceCents;
  const [inc, exp, sav] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(i.amount_cents), 0) AS total FROM incomes i JOIN financial_periods p ON p.id = i.period_id
         LEFT JOIN income_details d ON d.income_id = i.id
         WHERE i.user_id = ? AND p.month BETWEEN ? AND ? AND COALESCE(d.status, 'confirmed') IN ('confirmed', 'completed') AND COALESCE(d.paid_to, 'user') = 'user'`,
      )
      .bind(userId, start, end),
    db
      .prepare(
        `SELECT COALESCE(SUM(a.amount_cents), 0) AS total FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
         JOIN financial_periods p ON p.id = e.period_id WHERE e.user_id = ? AND p.month BETWEEN ? AND ?`,
      )
      .bind(userId, start, end),
    db
      .prepare(
        `SELECT COALESCE(SUM(s.amount_cents), 0) AS total FROM savings s JOIN financial_periods p ON p.id = s.period_id
         WHERE s.user_id = ? AND p.month BETWEEN ? AND ?`,
      )
      .bind(userId, start, end),
  ]);
  const t = (r: D1Result) => (r.results[0] as { total: number }).total;
  return settings.openingBalanceCents + t(inc) - t(exp) - t(sav);
}
