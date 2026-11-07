/**
 * Revenus V2 : types, statuts et règles de calcul.
 *
 * Règle centrale : seul l'argent REÇU par l'utilisateur est du « cash disponible ».
 *  - reçu       = statut « confirmé » ou « terminé » ET versé à l'utilisateur
 *  - attendu    = « attendu », « en attente » ou « accordé » (montant prévu, pas encore reçu)
 *  - indirect   = versé directement à un tiers (ex. APL versée au propriétaire) : jamais du cash
 *  - exclu      = « suspendu » ou « annulé »
 * Le brut n'est jamais confondu avec le net, ni le net calculé avec le montant réellement reçu.
 */
export const INCOME_KINDS = [
  { id: "alternance", label: "Alternance", group: "work" },
  { id: "salary", label: "Salaire", group: "work" },
  { id: "freelance", label: "Freelance", group: "work" },
  { id: "bonus", label: "Prime / bonus", group: "work" },
  { id: "exceptional", label: "Revenu exceptionnel", group: "other" },
  { id: "caf", label: "Allocation CAF", group: "benefit" },
  { id: "apl", label: "Aide au logement (APL)", group: "benefit" },
  { id: "prime_activite", label: "Prime d'activité", group: "benefit" },
  { id: "scholarship", label: "Bourse étudiante", group: "benefit" },
  { id: "other_aid", label: "Autre aide financière", group: "benefit" },
  { id: "employer_reimbursement", label: "Remboursement employeur", group: "reimbursement" },
  { id: "transport_reimbursement", label: "Remboursement transport", group: "reimbursement" },
  { id: "other_benefit", label: "Autre prestation", group: "benefit" },
  { id: "other", label: "Autre revenu", group: "other" },
] as const;

export type IncomeKind = (typeof INCOME_KINDS)[number]["id"];
export type IncomeGroup = (typeof INCOME_KINDS)[number]["group"];
export const INCOME_KIND_IDS = INCOME_KINDS.map((k) => k.id) as [IncomeKind, ...IncomeKind[]];
export const incomeKindLabel = (id: string) => INCOME_KINDS.find((k) => k.id === id)?.label ?? "Autre revenu";
export const incomeKindGroup = (id: string): IncomeGroup => INCOME_KINDS.find((k) => k.id === id)?.group ?? "other";

export const INCOME_STATUSES = [
  { id: "expected", label: "Attendu" },
  { id: "pending", label: "En attente" },
  { id: "approved", label: "Accordé" },
  { id: "confirmed", label: "Confirmé" },
  { id: "completed", label: "Terminé" },
  { id: "suspended", label: "Suspendu" },
  { id: "cancelled", label: "Annulé" },
] as const;
export type IncomeStatus = (typeof INCOME_STATUSES)[number]["id"];
export const INCOME_STATUS_IDS = INCOME_STATUSES.map((s) => s.id) as [IncomeStatus, ...IncomeStatus[]];
export const incomeStatusLabel = (id: string) => INCOME_STATUSES.find((s) => s.id === id)?.label ?? id;

export const FREQUENCIES = [
  { id: "once", label: "Ponctuel" },
  { id: "weekly", label: "Hebdomadaire" },
  { id: "monthly", label: "Mensuel" },
  { id: "quarterly", label: "Trimestriel" },
  { id: "yearly", label: "Annuel" },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]["id"];
export const FREQUENCY_IDS = FREQUENCIES.map((f) => f.id) as [Frequency, ...Frequency[]];
export const frequencyLabel = (id: string) => FREQUENCIES.find((f) => f.id === id)?.label ?? id;

export type PaidTo = "user" | "third_party";
export type CashState = "received" | "expected" | "indirect" | "excluded";

export function incomeCashState(status: IncomeStatus, paidTo: PaidTo): CashState {
  if (status === "suspended" || status === "cancelled") return "excluded";
  if (paidTo === "third_party") return "indirect";
  return status === "confirmed" || status === "completed" ? "received" : "expected";
}

export interface SalaryBreakdown {
  grossCents: number;
  employeeContributionsCents: number;
  otherDeductionsCents: number;
  withholdingCents: number;
}

/** Net = brut − cotisations salariales − autres retenues − prélèvement à la source. null si le résultat est négatif. */
export function computeNetSalary(b: SalaryBreakdown): number | null {
  const net = b.grossCents - b.employeeContributionsCents - b.otherDeductionsCents - b.withholdingCents;
  return net >= 0 ? net : null;
}

export interface IncomeLike {
  amountCents: number;
  status: IncomeStatus;
  paidTo: PaidTo;
}

export interface IncomeTotals {
  receivedCents: number;
  expectedCents: number;
  indirectCents: number;
  excludedCents: number;
}

export function summarizeIncomes(rows: IncomeLike[]): IncomeTotals {
  const t: IncomeTotals = { receivedCents: 0, expectedCents: 0, indirectCents: 0, excludedCents: 0 };
  for (const r of rows) {
    const state = incomeCashState(r.status, r.paidTo);
    if (state === "received") t.receivedCents += r.amountCents;
    else if (state === "expected") t.expectedCents += r.amountCents;
    else if (state === "indirect") t.indirectCents += r.amountCents;
    else t.excludedCents += r.amountCents;
  }
  return t;
}
