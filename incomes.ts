import { computeNetSalary, type Frequency, type IncomeKind, type IncomeStatus, type PaidTo } from "../../shared/income";
import { ApiError } from "./http";

/** Champs métier d'un revenu, après fusion (création) ou fusion avec l'existant (modification). */
export interface IncomeFields {
  label: string;
  source: "alternance" | "freelance" | "other";
  kind: IncomeKind;
  status: IncomeStatus;
  frequency: Frequency;
  amountCents: number | undefined;
  receivedOn: string | null;
  expectedDate: string | null;
  grossCents: number | null;
  employeeContributionsCents: number | null;
  otherDeductionsCents: number | null;
  withholdingCents: number | null;
  organization: string | null;
  benefitType: string | null;
  estimatedCents: number | null;
  confirmedCents: number | null;
  paidTo: PaidTo;
  thirdPartyName: string | null;
  notes: string | null;
}

export interface ResolvedIncome extends Omit<IncomeFields, "amountCents"> {
  amountCents: number;
}

const isReceived = (s: IncomeStatus) => s === "confirmed" || s === "completed";

/**
 * Règles métier des revenus :
 *  - une date de réception suppose un revenu confirmé ou terminé ;
 *  - brut − cotisations − retenues − prélèvement = net (jamais négatif) ;
 *  - le montant enregistré est, par ordre : montant saisi, sinon montant confirmé / net / estimé selon le statut ;
 *  - toutes les dates doivent se situer dans le mois du revenu.
 */
export function resolveIncome(f: IncomeFields, month: string): ResolvedIncome {
  if (f.receivedOn && !isReceived(f.status)) {
    throw new ApiError(400, "Une date de réception suppose un revenu confirmé : changez le statut ou retirez la date.");
  }
  if (f.receivedOn && !f.receivedOn.startsWith(month)) throw new ApiError(400, "La date doit se situer dans le mois choisi.");
  if (f.expectedDate && !f.expectedDate.startsWith(month)) throw new ApiError(400, "La date attendue doit se situer dans le mois choisi.");

  let net: number | null = null;
  if (f.grossCents !== null) {
    net = computeNetSalary({
      grossCents: f.grossCents,
      employeeContributionsCents: f.employeeContributionsCents ?? 0,
      otherDeductionsCents: f.otherDeductionsCents ?? 0,
      withholdingCents: f.withholdingCents ?? 0,
    });
    if (net === null) throw new ApiError(400, "Les retenues dépassent le salaire brut.");
  }
  const amount =
    f.amountCents ??
    (isReceived(f.status) ? (f.confirmedCents ?? net ?? f.estimatedCents) : (f.estimatedCents ?? net ?? f.confirmedCents)) ??
    undefined;
  if (amount === undefined || amount === null) throw new ApiError(400, "Indiquez un montant.");
  return { ...f, amountCents: amount };
}

export function incomeWriteStatements(db: D1Database, userId: string, incomeId: string, r: ResolvedIncome) {
  return db
    .prepare(
      `INSERT INTO income_details (income_id, user_id, kind, status, frequency, expected_date, gross_cents,
         employee_contributions_cents, other_deductions_cents, withholding_cents, organization, benefit_type,
         estimated_cents, confirmed_cents, paid_to, third_party_name, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (income_id) DO UPDATE SET kind = excluded.kind, status = excluded.status, frequency = excluded.frequency,
         expected_date = excluded.expected_date, gross_cents = excluded.gross_cents,
         employee_contributions_cents = excluded.employee_contributions_cents, other_deductions_cents = excluded.other_deductions_cents,
         withholding_cents = excluded.withholding_cents, organization = excluded.organization, benefit_type = excluded.benefit_type,
         estimated_cents = excluded.estimated_cents, confirmed_cents = excluded.confirmed_cents, paid_to = excluded.paid_to,
         third_party_name = excluded.third_party_name, notes = excluded.notes, updated_at = excluded.updated_at`,
    )
    .bind(
      incomeId, userId, r.kind, r.status, r.frequency, r.expectedDate, r.grossCents, r.employeeContributionsCents,
      r.otherDeductionsCents, r.withholdingCents, r.organization, r.benefitType, r.estimatedCents, r.confirmedCents,
      r.paidTo, r.thirdPartyName, r.notes, new Date().toISOString(),
    );
}
