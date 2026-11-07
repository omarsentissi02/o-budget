import { addDaysISO, diffDays, lastDayOfMonth, occurrencesBetween, parseISO, fmtISO } from "./recurrence";
import type { Frequency } from "./income";

/**
 * Règles de calcul du budget — 100 % déterministes, jamais déléguées au modèle de langage.
 *
 * Vocabulaire (les six notions restent distinctes) :
 *  1. Solde du mois (cash)       = revenus REÇUS − dépenses
 *  2. Budget disponible          = solde du mois − épargne déjà mise de côté (l'épargne faite n'est plus dépensable)
 *  3. Obligations à venir        = échéances non payées (abonnements, charges fixes) jusqu'à la fin du mois
 *  4. Épargne prévue (restante)  = max(0, objectif mensuel − épargne déjà faite)
 *  5. Revenus attendus           = revenus non encore reçus : JAMAIS comptés comme disponibles
 *  6. Cash réellement reçu       = revenus au statut confirmé / terminé, versés à l'utilisateur
 *
 *  Dépense quotidienne conseillée =
 *     (budget disponible − obligations à venir − épargne prévue restante − réserve de sécurité) / jours restants
 *  (jours restants = aujourd'hui inclus jusqu'à la fin du mois, minimum 1)
 */

/** Catégories exclues du rythme de dépense « variable » (charges fixes et dépenses ponctuelles). */
export const NON_VARIABLE_CATEGORIES: readonly string[] = ["logement", "assurance", "abonnements", "telecom", "exceptionnel"];

export function remainingDaysInMonth(month: string, today: string): number {
  const [y, m] = month.split("-").map(Number);
  const last = lastDayOfMonth(y, m);
  const todayMonth = today.slice(0, 7);
  if (todayMonth > month) return 0;
  if (todayMonth < month) return last;
  return last - parseISO(today).d + 1;
}

export function elapsedDaysInMonth(month: string, today: string): number {
  const [y, m] = month.split("-").map(Number);
  const todayMonth = today.slice(0, 7);
  if (todayMonth > month) return lastDayOfMonth(y, m);
  if (todayMonth < month) return 0;
  return parseISO(today).d;
}

export interface MonthPositionInput {
  month: string;
  today: string;
  receivedIncomeCents: number;
  expectedIncomeCents: number;
  expensesCents: number;
  savingsDoneCents: number;
  savingsTargetCents: number;
  /** Échéances non payées dont la date ≤ fin du mois (en retard incluses). */
  obligationsDueCents: number;
  safetyReserveCents: number;
  /** Dépenses des catégories variables sur la période écoulée (pour la projection). */
  variableExpensesCents: number;
}

export interface MonthPosition {
  /** (1) revenus reçus − dépenses */
  cashCents: number;
  /** (6) */
  receivedIncomeCents: number;
  /** (5) — non disponible tant que non reçu */
  expectedIncomeCents: number;
  /** (3) */
  obligationsDueCents: number;
  /** (4) */
  plannedSavingsRemainingCents: number;
  safetyReserveCents: number;
  /** (2) solde du mois − épargne déjà faite */
  availableFundsCents: number;
  /** disponible − obligations − épargne prévue − réserve : peut être négatif */
  discretionaryCents: number;
  remainingDays: number;
  /** Montant journalier conseillé (≥ 0, arrondi au centime inférieur) */
  dailyAllowanceCents: number;
  /** Montant manquant si le budget discrétionnaire est négatif */
  shortfallCents: number;
  /** Rythme de dépense variable observé (centimes / jour écoulé) */
  variableRunRateCents: number;
  /** Solde projeté fin de mois, prudent : sans revenus attendus, au rythme variable actuel. */
  projectedEndCashCents: number;
  /** Même projection si TOUS les revenus attendus du mois arrivent. Scénario, pas du cash. */
  projectedEndCashWithExpectedCents: number;
  status: "ok" | "tight" | "deficit";
}

export function computeMonthPosition(i: MonthPositionInput): MonthPosition {
  const cashCents = i.receivedIncomeCents - i.expensesCents;
  const availableFundsCents = cashCents - i.savingsDoneCents;
  const plannedSavingsRemainingCents = Math.max(0, i.savingsTargetCents - i.savingsDoneCents);
  const discretionaryCents =
    availableFundsCents - i.obligationsDueCents - plannedSavingsRemainingCents - i.safetyReserveCents;
  const remainingDays = remainingDaysInMonth(i.month, i.today);
  const divisor = Math.max(1, remainingDays);
  const dailyAllowanceCents = discretionaryCents > 0 ? Math.floor(discretionaryCents / divisor) : 0;

  const elapsed = Math.max(1, elapsedDaysInMonth(i.month, i.today));
  const variableRunRateCents = Math.round(i.variableExpensesCents / elapsed);
  // Jours futurs (aujourd'hui est déjà compté dans les jours écoulés).
  const futureDays = Math.max(0, remainingDays - 1);
  const projectedVariable = variableRunRateCents * futureDays;
  const projectedEndCashCents = availableFundsCents - i.obligationsDueCents - plannedSavingsRemainingCents - projectedVariable;

  let status: MonthPosition["status"] = "ok";
  if (discretionaryCents < 0 || projectedEndCashCents < 0) status = "deficit";
  else if (variableRunRateCents > 0 && dailyAllowanceCents > 0 && variableRunRateCents > dailyAllowanceCents) status = "tight";

  return {
    cashCents,
    receivedIncomeCents: i.receivedIncomeCents,
    expectedIncomeCents: i.expectedIncomeCents,
    obligationsDueCents: i.obligationsDueCents,
    plannedSavingsRemainingCents,
    safetyReserveCents: i.safetyReserveCents,
    availableFundsCents,
    discretionaryCents,
    remainingDays,
    dailyAllowanceCents,
    shortfallCents: discretionaryCents < 0 ? -discretionaryCents : 0,
    variableRunRateCents,
    projectedEndCashCents,
    projectedEndCashWithExpectedCents: projectedEndCashCents + i.expectedIncomeCents,
    status,
  };
}

// --- Budgets par catégorie ----------------------------------------------------------------------

export interface BudgetStatus {
  spentCents: number;
  limitCents: number;
  remainingCents: number;
  /** 0–… (peut dépasser 1) ; null si pas de limite */
  ratio: number | null;
  state: "ok" | "warning" | "over" | "none";
}

export function budgetStatus(spentCents: number, limitCents: number | null, warnAt = 0.8): BudgetStatus {
  if (limitCents === null || limitCents <= 0) {
    return { spentCents, limitCents: 0, remainingCents: 0, ratio: null, state: "none" };
  }
  const ratio = spentCents / limitCents;
  return {
    spentCents,
    limitCents,
    remainingCents: limitCents - spentCents,
    ratio,
    state: ratio > 1 ? "over" : ratio >= warnAt ? "warning" : "ok",
  };
}

// --- Échéances et prévisions ----------------------------------------------------------------------

export interface DueItem {
  id: string;
  label: string;
  amountCents: number;
  dueDate: string;
  kind: "subscription" | "recurring";
}

/** Somme des échéances dont la date ≤ fin du mois (les retards sont inclus : ils restent à payer). */
export function sumObligations(items: DueItem[], month: string): number {
  const [y, m] = month.split("-").map(Number);
  const end = fmtISO(y, m, lastDayOfMonth(y, m));
  return items.filter((x) => x.dueDate <= end).reduce((s, x) => s + x.amountCents, 0);
}

export interface RecurringSchedule {
  label: string;
  amountCents: number;
  nextDate: string;
  frequency: Frequency;
}

export interface ForecastMonth {
  month: string;
  expectedIncomeCents: number;
  obligationsCents: number;
  variableSpendCents: number;
  plannedSavingsCents: number;
  netCents: number;
  endCashCents: number;
}

/**
 * Prévision de trésorerie sur `count` mois à partir de `startMonth` (le mois suivant en général).
 * Utilise UNIQUEMENT des éléments saisis : revenus récurrents attendus, échéances récurrentes/abonnements,
 * moyenne des dépenses variables passées et objectif d'épargne. Rien n'est inventé.
 */
export function forecastMonths(opts: {
  startMonth: string;
  count: number;
  startingCashCents: number;
  incomes: RecurringSchedule[];
  obligations: RecurringSchedule[];
  avgVariableSpendCents: number;
  plannedSavingsCents: number;
}): ForecastMonth[] {
  const out: ForecastMonth[] = [];
  let cash = opts.startingCashCents;
  let [y, m] = opts.startMonth.split("-").map(Number);
  for (let k = 0; k < opts.count; k++) {
    const from = fmtISO(y, m, 1);
    const to = fmtISO(y, m, lastDayOfMonth(y, m));
    const sum = (list: RecurringSchedule[]) =>
      list.reduce((s, it) => s + it.amountCents * occurrencesBetween(it.nextDate, it.frequency, from, to).length, 0);
    const expectedIncomeCents = sum(opts.incomes);
    const obligationsCents = sum(opts.obligations);
    const netCents = expectedIncomeCents - obligationsCents - opts.avgVariableSpendCents - opts.plannedSavingsCents;
    cash += netCents;
    out.push({
      month: `${y}-${String(m).padStart(2, "0")}`,
      expectedIncomeCents,
      obligationsCents,
      variableSpendCents: opts.avgVariableSpendCents,
      plannedSavingsCents: opts.plannedSavingsCents,
      netCents,
      endCashCents: cash,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Jours entre aujourd'hui et une échéance (négatif = en retard). */
export const daysUntil = (today: string, date: string) => diffDays(today, date);
export { addDaysISO };

/**
 * Versement mensuel nécessaire pour atteindre un objectif à son échéance.
 * mois restants = ceil(jours / 30,4375), au moins 1. null si pas d'échéance ou objectif atteint.
 */
export function requiredMonthlySaving(targetCents: number, savedCents: number, today: string, deadline: string | null): number | null {
  const remaining = targetCents - savedCents;
  if (!deadline || remaining <= 0) return null;
  const days = diffDays(today, deadline);
  const months = Math.max(1, Math.ceil(days / 30.4375));
  return Math.ceil(remaining / months);
}
