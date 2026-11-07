import { categoryBreakdown, computeTotals } from "../../shared/finance";
import type { ExpenseEntryDTO, IncomeDTO, IncomeSource, MonthSummaryDTO } from "../../shared/types";
import { categoryOrder, type CategoryId } from "../../shared/categories";
import {
  computeNetSalary,
  incomeCashState,
  incomeKindGroup,
  summarizeIncomes,
  type Frequency,
  type IncomeKind,
  type IncomeStatus,
  type PaidTo,
} from "../../shared/income";
import { getSubcategory } from "../../shared/taxonomy";
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

// --- Revenus ---------------------------------------------------------------------------------------------

export interface IncomeRow {
  id: string;
  source: IncomeSource;
  label: string;
  amount_cents: number;
  received_on: string | null;
  kind: IncomeKind | null;
  status: IncomeStatus;
  frequency: Frequency;
  expected_date: string | null;
  gross_cents: number | null;
  employee_contributions_cents: number | null;
  other_deductions_cents: number | null;
  withholding_cents: number | null;
  organization: string | null;
  benefit_type: string | null;
  estimated_cents: number | null;
  confirmed_cents: number | null;
  paid_to: PaidTo;
  third_party_name: string | null;
  notes: string | null;
}

/** Les revenus V1 n'ont pas de ligne income_details : ils valent « confirmé, versé à l'utilisateur ». */
export const INCOME_SELECT = `
  SELECT i.id, i.source, i.label, i.amount_cents, i.received_on,
    d.kind, COALESCE(d.status, 'confirmed') AS status, COALESCE(d.frequency, 'once') AS frequency, d.expected_date,
    d.gross_cents, d.employee_contributions_cents, d.other_deductions_cents, d.withholding_cents,
    d.organization, d.benefit_type, d.estimated_cents, d.confirmed_cents,
    COALESCE(d.paid_to, 'user') AS paid_to, d.third_party_name, d.notes
  FROM incomes i LEFT JOIN income_details d ON d.income_id = i.id`;

export const toIncomeDTO = (r: IncomeRow): IncomeDTO => {
  const kind: IncomeKind = r.kind ?? (r.source === "alternance" || r.source === "freelance" ? r.source : "other");
  const net =
    r.gross_cents === null
      ? null
      : computeNetSalary({
          grossCents: r.gross_cents,
          employeeContributionsCents: r.employee_contributions_cents ?? 0,
          otherDeductionsCents: r.other_deductions_cents ?? 0,
          withholdingCents: r.withholding_cents ?? 0,
        });
  return {
    id: r.id,
    source: r.source,
    label: r.label,
    amountCents: r.amount_cents,
    receivedOn: r.received_on,
    kind,
    status: r.status,
    cashState: incomeCashState(r.status, r.paid_to),
    frequency: r.frequency,
    expectedDate: r.expected_date,
    grossCents: r.gross_cents,
    employeeContributionsCents: r.employee_contributions_cents,
    otherDeductionsCents: r.other_deductions_cents,
    withholdingCents: r.withholding_cents,
    netCents: net,
    organization: r.organization,
    benefitType: r.benefit_type,
    estimatedCents: r.estimated_cents,
    confirmedCents: r.confirmed_cents,
    paidTo: r.paid_to,
    thirdPartyName: r.third_party_name,
    notes: r.notes,
  };
};

export const incomeGroupOf = (dto: IncomeDTO) => incomeKindGroup(dto.kind);

export async function getMonthSummary(db: D1Database, userId: string, month: string): Promise<MonthSummaryDTO> {
  const periodId = await findPeriodId(db, userId, month);
  const emptyIncome = summarizeIncomes([]);
  if (!periodId) {
    return {
      month,
      incomes: [],
      savingsCents: 0,
      totals: computeTotals([], [], 0),
      income: emptyIncome,
      categories: categoryBreakdown([]),
    };
  }
  const [incomes, categories, savings] = await db.batch([
    db
      .prepare(
        `${INCOME_SELECT} WHERE i.user_id = ? AND i.period_id = ?
         ORDER BY CASE i.source WHEN 'alternance' THEN 0 WHEN 'freelance' THEN 1 ELSE 2 END, i.created_at`,
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
  const incomeDtos = (incomes.results as unknown as IncomeRow[]).map(toIncomeDTO);
  const catRows = categories.results as unknown as { category_id: string; total: number }[];
  const savingsCents = (savings.results[0] as { amount_cents: number } | undefined)?.amount_cents ?? 0;
  const income = summarizeIncomes(incomeDtos.map((i) => ({ amountCents: i.amountCents, status: i.status, paidTo: i.paidTo })));
  return {
    month,
    incomes: incomeDtos,
    savingsCents,
    // « Revenus » = argent REÇU. Les revenus attendus restent dans `income.expectedCents`.
    totals: computeTotals([income.receivedCents], catRows.map((r) => r.total), savingsCents),
    income,
    categories: categoryBreakdown(catRows.map((r) => ({ categoryId: r.category_id, amountCents: r.total }))),
  };
}

// --- Dépenses -----------------------------------------------------------------------------------------------

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
  notes: string | null;
  channel: string | null;
}

interface AmountRow {
  entry_id: string;
  category_id: string;
  amount_cents: number;
  subcategory_id: string | null;
  sub_label: string | null;
  merchant_id: string | null;
  merchant_label: string | null;
  platform_id: string | null;
  trip_from: string | null;
  trip_to: string | null;
  trip_date: string | null;
  note: string | null;
}

const ENTRY_COLUMNS =
  "e.id, e.spent_on, e.location_type, e.country_code, e.country_name, e.city, e.payment_method_id, e.payment_label, e.description, e.notes, e.channel";

const AMOUNT_COLUMNS = `a.entry_id, a.category_id, a.amount_cents, a.subcategory_id, s.label AS sub_label,
  a.merchant_id, a.merchant_label, a.platform_id, a.trip_from, a.trip_to, a.trip_date, a.note`;
const AMOUNT_FROM = "expense_amounts a JOIN expense_entries e ON e.id = a.entry_id LEFT JOIN subcategories s ON s.id = a.subcategory_id";

function assemble(rows: EntryRow[], amounts: AmountRow[]) {
  const byEntry = new Map<string, AmountRow[]>();
  for (const a of amounts) {
    const list = byEntry.get(a.entry_id) ?? [];
    list.push(a);
    byEntry.set(a.entry_id, list);
  }
  return rows.map<ExpenseEntryDTO>((r) => {
    const list = (byEntry.get(r.id) ?? []).sort((x, y) => categoryOrder(x.category_id) - categoryOrder(y.category_id));
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
      notes: r.notes,
      channel: r.channel,
      amounts: list.map((a) => ({
        categoryId: a.category_id as CategoryId,
        amountCents: a.amount_cents,
        subcategoryId: a.subcategory_id,
        subcategoryLabel: getSubcategory(a.subcategory_id)?.label ?? a.sub_label,
        merchantId: a.merchant_id,
        merchantLabel: a.merchant_label,
        platformId: a.platform_id,
        tripFrom: a.trip_from,
        tripTo: a.trip_to,
        tripDate: a.trip_date,
        note: a.note,
      })),
      totalCents: list.reduce((s, a) => s + a.amount_cents, 0),
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
        `SELECT ${AMOUNT_COLUMNS} FROM ${AMOUNT_FROM} JOIN financial_periods p ON p.id = e.period_id
         WHERE e.user_id = ? AND p.month = ?`,
      )
      .bind(userId, month),
  ]);
  return assemble(entries.results as unknown as EntryRow[], amounts.results as unknown as AmountRow[]);
}

export async function listRecentEntries(db: D1Database, userId: string, limit: number) {
  const entries = await db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM expense_entries e WHERE e.user_id = ? ORDER BY e.spent_on DESC, e.created_at DESC LIMIT ?`)
    .bind(userId, limit)
    .all<EntryRow>();
  if (entries.results.length === 0) return [];
  const marks = entries.results.map(() => "?").join(",");
  const amounts = await db
    .prepare(`SELECT ${AMOUNT_COLUMNS} FROM ${AMOUNT_FROM} WHERE e.user_id = ? AND e.id IN (${marks})`)
    .bind(userId, ...entries.results.map((e) => e.id))
    .all<AmountRow>();
  return assemble(entries.results, amounts.results);
}

export async function getEntry(db: D1Database, userId: string, id: string): Promise<ExpenseEntryDTO | null> {
  const [entries, amounts] = await db.batch([
    db.prepare(`SELECT ${ENTRY_COLUMNS} FROM expense_entries e WHERE e.id = ? AND e.user_id = ?`).bind(id, userId),
    db.prepare(`SELECT ${AMOUNT_COLUMNS} FROM ${AMOUNT_FROM} WHERE e.id = ? AND e.user_id = ?`).bind(id, userId),
  ]);
  return assemble(entries.results as unknown as EntryRow[], amounts.results as unknown as AmountRow[])[0] ?? null;
}
