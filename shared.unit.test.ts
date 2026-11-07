import { describe, expect, it } from "vitest";
import { computeMonthPosition, remainingDaysInMonth, budgetStatus, requiredMonthlySaving } from "../shared/budget";
import { addMonthsISO, nextAfter, monthlyEquivalentCents, occurrencesBetween } from "../shared/recurrence";
import { computeNetSalary, incomeCashState, summarizeIncomes } from "../shared/income";
import { parseQuickTask, nextDueDate } from "../shared/tasks";
import { findDuplicateSubscriptions } from "../shared/subscriptions";
import { csvSafe } from "./helpers/csv";

const base = { month: "2026-11", today: "2026-11-10", receivedIncomeCents: 200000, expectedIncomeCents: 0, expensesCents: 50000, savingsDoneCents: 0, savingsTargetCents: 0, obligationsDueCents: 0, safetyReserveCents: 0, variableExpensesCents: 0 };

describe("budget : montant journalier", () => {
  it("(disponible − obligations − épargne − réserve) / jours restants", () => {
    const p = computeMonthPosition({ ...base, obligationsDueCents: 30000, savingsTargetCents: 20000, safetyReserveCents: 10000 });
    expect(p.remainingDays).toBe(21);
    expect(p.dailyAllowanceCents).toBe(Math.floor(90000 / 21));
  });
  it("jamais négatif ; manque signalé ; statut déficit", () => {
    const p = computeMonthPosition({ ...base, obligationsDueCents: 200000 });
    expect(p.dailyAllowanceCents).toBe(0);
    expect(p.shortfallCents).toBe(50000);
    expect(p.status).toBe("deficit");
  });
  it("dernier jour du mois : 1 jour restant ; mois passé : 0 ; mois futur : tous les jours", () => {
    expect(remainingDaysInMonth("2026-11", "2026-11-30")).toBe(1);
    expect(remainingDaysInMonth("2026-10", "2026-11-05")).toBe(0);
    expect(remainingDaysInMonth("2026-12", "2026-11-05")).toBe(31);
  });
  it("revenus attendus : jamais dans le disponible", () => {
    const p = computeMonthPosition({ ...base, expectedIncomeCents: 99999 });
    expect(p.availableFundsCents).toBe(150000);
    expect(p.projectedEndCashWithExpectedCents - p.projectedEndCashCents).toBe(99999);
  });
  it("états de budget et objectif", () => {
    expect(budgetStatus(7999, 10000).state).toBe("ok");
    expect(budgetStatus(8000, 10000).state).toBe("warning");
    expect(budgetStatus(10001, 10000).state).toBe("over");
    expect(budgetStatus(5, null).state).toBe("none");
    expect(requiredMonthlySaving(1000, 1000, "2026-11-01", "2027-01-01")).toBeNull();
    expect(requiredMonthlySaving(1000, 0, "2026-11-01", null)).toBeNull();
  });
});

describe("récurrence", () => {
  it("fin de mois : ancrage au 31 conservé", () => {
    expect(addMonthsISO("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonthsISO("2026-01-31", 2, 31)).toBe("2026-03-31");
    expect(addMonthsISO("2024-01-31", 1, 31)).toBe("2024-02-29");
  });
  it("occurrences et équivalent mensuel", () => {
    expect(occurrencesBetween("2026-11-01", "monthly", "2026-11-01", "2027-01-31")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(monthlyEquivalentCents(1200, "yearly")).toBe(100);
    expect(monthlyEquivalentCents(1200, "quarterly")).toBe(400);
    expect(monthlyEquivalentCents(1200, "weekly")).toBe(Math.round((1200 * 52) / 12));
    expect(nextAfter("2026-11-01", "monthly", "2026-11-01")).toBe("2026-12-01");
  });
});

describe("revenus", () => {
  it("net = brut − cotisations − autres − prélèvement", () => {
    expect(computeNetSalary({ grossCents: 250000, employeeContributionsCents: 50000, otherDeductionsCents: 1000, withholdingCents: 9000 })).toBe(190000);
  });
  it("états de trésorerie", () => {
    expect(incomeCashState("confirmed", "user")).toBe("received");
    expect(incomeCashState("expected", "user")).toBe("expected");
    expect(incomeCashState("confirmed", "third_party")).toBe("indirect");
    expect(incomeCashState("cancelled", "user")).toBe("excluded");
  });
  it("synthèse : seul le reçu compte comme cash", () => {
    const s = summarizeIncomes([
      { amountCents: 1000, status: "confirmed", paidTo: "user" },
      { amountCents: 500, status: "expected", paidTo: "user" },
      { amountCents: 300, status: "confirmed", paidTo: "third_party" },
      { amountCents: 200, status: "cancelled", paidTo: "user" },
    ]);
    expect(s.receivedCents).toBe(1000);
    expect(s.expectedCents).toBe(500);
  });
});

describe("tâches", () => {
  it("saisie rapide : jour de la semaine, date, sans date", () => {
    const t = parseQuickTask("Rendre le rapport le 12/11 !", "2026-11-07");
    expect(t).toMatchObject({ title: "Rendre le rapport", dueDate: "2026-11-12", priority: "important" });
    expect(parseQuickTask("Courses lundi", "2026-11-07").dueDate).toBe("2026-11-09");
    expect(parseQuickTask("Idée", "2026-11-07").dueDate).toBeNull();
  });
  it("récurrence : jours ouvrés saute le week-end", () => {
    expect(nextDueDate("2026-11-06", "weekdays")).toBe("2026-11-09");
    expect(nextDueDate("2026-11-30", "monthly")).toBe("2026-12-30");
  });
});

describe("abonnements : doublons", () => {
  it("même nom normalisé détecté, noms différents ignorés", () => {
    const mk = (id: string, name: string) => ({ id, name, family: "pro" as const, amountCents: 1, frequency: "monthly" as const, status: "active" as const, renewalDate: null });
    expect(findDuplicateSubscriptions([mk("1", "Canva"), mk("2", "canva pro"), mk("3", "Notion")])).toHaveLength(1);
  });
});

describe("export CSV", () => {
  it("neutralise les formules", () => {
    expect(csvSafe("=1+1")).toBe("'=1+1");
    expect(csvSafe("-2+3")).toBe("'-2+3");
    expect(csvSafe("Café")).toBe("Café");
  });
});
