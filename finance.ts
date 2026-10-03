import { CATEGORIES, type CategoryId } from "./categories";

export interface MonthTotals {
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
  /** Revenus − Dépenses. L'épargne n'est PAS soustraite une seconde fois. */
  remainingCents: number;
  /** Épargne / Revenus × 100, null si aucun revenu. */
  savingsRate: number | null;
}

export interface CategoryTotal {
  categoryId: CategoryId;
  amountCents: number;
  /** Part des dépenses totales du mois (0–100). */
  percent: number;
}

const sum = (values: number[]) => values.reduce((acc, v) => acc + v, 0);

export function computeTotals(
  incomeAmounts: number[],
  expenseAmounts: number[],
  savingsCents: number,
): MonthTotals {
  const incomeCents = sum(incomeAmounts);
  const expenseCents = sum(expenseAmounts);
  return {
    incomeCents,
    expenseCents,
    savingsCents,
    remainingCents: incomeCents - expenseCents,
    savingsRate: incomeCents > 0 ? (savingsCents / incomeCents) * 100 : null,
  };
}

/** Les dix catégories, toujours présentes, triées par montant décroissant puis par ordre d'origine. */
export function categoryBreakdown(rows: { categoryId: string; amountCents: number }[]): CategoryTotal[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.categoryId, (totals.get(r.categoryId) ?? 0) + r.amountCents);
  const grand = sum([...totals.values()]);
  return CATEGORIES.map((c, index) => ({ c, index, amount: totals.get(c.id) ?? 0 }))
    .sort((a, b) => b.amount - a.amount || a.index - b.index)
    .map(({ c, amount }) => ({
      categoryId: c.id,
      amountCents: amount,
      percent: grand > 0 ? (amount / grand) * 100 : 0,
    }));
}

/** Variation en % entre deux valeurs ; null si la base est nulle. */
export function percentChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
