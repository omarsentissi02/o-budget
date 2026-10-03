import { categoryBreakdown, computeTotals } from "../../shared/finance";
import type { ExpenseEntryDTO, IncomeDTO, IncomeSource, MonthSummaryDTO } from "../../shared/types";
import { categoryOrder, type CategoryId } from "../../shared/categories";
import { uuid } from "./http";

export async function findPeriodId(db: D1Database, userId: string, month: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM financial_periods WHERE user_id = ? AND month = ?")
    .bind(userId, month)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function getOrCreatePeriodId(db: D1Database, userId: string, month: string): Promise<string> {
  await db
    .prepare("INSERT INTO financial_periods (id, user_id, month) VALUES (?, ?, ?) ON CONFLICT (user_id, month) DO NOTHING")
    .bind(uuid(), userId, month)
    .run();
  const id = await findPeriodId(db, userId, month);
  if (!id) throw new Error("period creation failed");
  return id;
}

interface IncomeRow {
  id: string;
  source: IncomeSource;
  label: string;
  amount_cents: number;
  received_on: string | null;
}

export const toIncomeDTO = (r: IncomeRow): IncomeDTO => ({
  id: r.id,
  source: r.source,
  label: r.label,
  amountCents: r.amount_cents,
  receivedOn: r.received_on,
});

export async function getMonthSummary(db: D1Database, userId: string, month: string): Promise<MonthSummaryDTO> {
  const periodId = await findPeriodId(db, userId, month);
  if (!periodId) {
    return { month, incomes: [], savingsCents: 0, totals: computeTotals([], [], 0), categories: categoryBreakdown([]) };
  }
  const [incomes, categories, savings] = await db.batch([
    db
      .prepare(
        `SELECT id, source, label, amount_cents, received_on FROM incomes
         WHERE user_id = ? AND period_id = ?
         ORDER BY CASE source WHEN 'alternance' THEN 0 WHEN 'freelance' THEN 1 ELSE 2 END, created_at`,
      )
      .bind(userId, periodId),
    db
      .prepare(
        `SELECT a.category_id AS category_id, SUM(a.amount_cents) AS total
         FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
         WHERE e.user_id = ? AND e.period_id = ?
         GROUP BY a.category_id`,
      )
      .bind(userId, periodId),
    db.prepare("SELECT amount_cents FROM savings WHERE user_id = ? AND period_id = ?").bind(userId, periodId),
  ]);
  const incomeRows = incomes.results as unknown as IncomeRow[];
  const catRows = categories.results as unknown as { category_id: string; total: number }[];
  const savingsCents = (savings.results[0] as { amount_cents: number } | undefined)?.amount_cents ?? 0;
  return {
    month,
    incomes: incomeRows.map(toIncomeDTO),
    savingsCents,
    totals: computeTotals(
      incomeRows.map((r) => r.amount_cents),
      catRows.map((r) => r.total),
      savingsCents,
    ),
    categories: categoryBreakdown(catRows.map((r) => ({ categoryId: r.category_id, amountCents: r.total }))),
  };
}

interface EntryRow {
  id: string;
  spent_on: string;
  location_type: "france" | "abroad";
  country_code: string | null;
  country_name: string;
  city: string | null;
  payment_method_id: string | null;
  payment_label: string;
  description: string | null;
}

const ENTRY_COLUMNS =
  "e.id, e.spent_on, e.location_type, e.country_code, e.country_name, e.city, e.payment_method_id, e.payment_label, e.description";

function assemble(rows: EntryRow[], amounts: { entry_id: string; category_id: string; amount_cents: number }[]) {
  const byEntry = new Map<string, { categoryId: CategoryId; amountCents: number }[]>();
  for (const a of amounts) {
    const list = byEntry.get(a.entry_id) ?? [];
    list.push({ categoryId: a.category_id as CategoryId, amountCents: a.amount_cents });
    byEntry.set(a.entry_id, list);
  }
  return rows.map<ExpenseEntryDTO>((r) => {
    const list = (byEntry.get(r.id) ?? []).sort((x, y) => categoryOrder(x.categoryId) - categoryOrder(y.categoryId));
    return {
      id: r.id,
      date: r.spent_on,
      location:
        r.location_type === "france"
          ? { type: "france", city: r.city ?? "" }
          : { type: "abroad", countryCode: r.country_code, countryName: r.country_name },
      paymentMethodId: r.payment_method_id,
      paymentLabel: r.payment_label,
      description: r.description,
      amounts: list,
      totalCents: list.reduce((s, a) => s + a.amountCents, 0),
    };
  });
}

export async function listEntriesForMonth(db: D1Database, userId: string, month: string) {
  const [entries, amounts] = await db.batch([
    db
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM expense_entries e JOIN financial_periods p ON p.id = e.period_id
         WHERE e.user_id = ? AND p.month = ? ORDER BY e.spent_on DESC, e.created_at DESC`,
      )
      .bind(userId, month),
    db
      .prepare(
        `SELECT a.entry_id, a.category_id, a.amount_cents FROM expense_amounts a
         JOIN expense_entries e ON e.id = a.entry_id JOIN financial_periods p ON p.id = e.period_id
         WHERE e.user_id = ? AND p.month = ?`,
      )
      .bind(userId, month),
  ]);
  return assemble(entries.results as unknown as EntryRow[], amounts.results as never);
}

export async function getEntry(db: D1Database, userId: string, id: string): Promise<ExpenseEntryDTO | null> {
  const [entries, amounts] = await db.batch([
    db.prepare(`SELECT ${ENTRY_COLUMNS} FROM expense_entries e WHERE e.id = ? AND e.user_id = ?`).bind(id, userId),
    db
      .prepare(
        `SELECT a.entry_id, a.category_id, a.amount_cents FROM expense_amounts a
         JOIN expense_entries e ON e.id = a.entry_id WHERE e.id = ? AND e.user_id = ?`,
      )
      .bind(id, userId),
  ]);
  return assemble(entries.results as unknown as EntryRow[], amounts.results as never)[0] ?? null;
}
