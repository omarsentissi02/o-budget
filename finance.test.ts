import { describe, expect, it } from "vitest";
import { categoryBreakdown, computeTotals, percentChange } from "../shared/finance";
import { centsToInput, formatEUR, parseAmountToCents } from "../shared/money";
import { isValidISODate, monthRange, shiftMonth, firstWeekdayOfMonth, daysInMonth } from "../shared/month";
import { expenseInputSchema } from "../shared/schemas";

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formules financières", () => {
  it("Reste = Revenus − Dépenses ; l'épargne n'est pas soustraite deux fois", () => {
    const t = computeTotals([170000], [82300], 30000);
    expect(t.remainingCents).toBe(87700);
    expect(t.savingsCents).toBe(30000);
    expect(t.savingsRate).toBeCloseTo(17.647, 2);
  });

  it("octobre exceptionnel : 300 + 500 + 150 = 950 €", () => {
    expect(computeTotals([30000, 50000, 15000], [], 0).incomeCents).toBe(95000);
  });

  it("taux d'épargne de l'exemple : 300 / 1 750 = 17,1 %", () => {
    expect(computeTotals([175000], [], 30000).savingsRate).toBeCloseTo(17.14, 1);
  });

  it("taux d'épargne nul si aucun revenu", () => {
    expect(computeTotals([], [1000], 500).savingsRate).toBeNull();
  });

  it("répartition : dix catégories, pourcentages qui totalisent 100", () => {
    const b = categoryBreakdown([
      { categoryId: "alimentation", amountCents: 1200 },
      { categoryId: "transport", amountCents: 500 },
      { categoryId: "shopping", amountCents: 2000 },
      { categoryId: "alimentation", amountCents: 300 },
    ]);
    expect(b).toHaveLength(10);
    expect(b[0]).toMatchObject({ categoryId: "shopping", amountCents: 2000 });
    expect(b[1]).toMatchObject({ categoryId: "alimentation", amountCents: 1500 });
    expect(b.reduce((s, c) => s + c.percent, 0)).toBeCloseTo(100, 6);
    expect(b.filter((c) => c.amountCents === 0)).toHaveLength(7);
  });

  it("variation en pourcentage", () => {
    expect(percentChange(90000, 82300)).toBeCloseTo(-8.56, 2);
    expect(percentChange(0, 100)).toBeNull();
  });
});

describe("montants", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12.50", 1250],
    ["1 202,00 €", 120200],
    ["0,99", 99],
  ])("lit %s", (input, cents) => expect(parseAmountToCents(input)).toBe(cents));

  it.each(["", "-5", "abc", "12,345", "1,2,3"])("refuse %s", (input) => expect(parseAmountToCents(input)).toBeNull());

  it("formate à la française", () => {
    expect(nbsp(formatEUR(120200))).toBe("1 202,00 €");
    expect(nbsp(formatEUR(50000))).toBe("500,00 €");
    expect(centsToInput(1250)).toBe("12,50");
  });
});

describe("mois et dates", () => {
  it("navigation entre mois", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthRange("2026-11", 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
  it("calendrier d'octobre 2026 : commence un jeudi, 31 jours", () => {
    expect(firstWeekdayOfMonth("2026-10")).toBe(3);
    expect(daysInMonth("2026-10")).toBe(31);
  });
  it("dates invalides", () => {
    expect(isValidISODate("2026-10-03")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("03/10/2026")).toBe(false);
  });
});

describe("validation d'une dépense", () => {
  const base = { date: "2026-10-03", location: { type: "france", city: "Paris" }, paymentMethodId: null };
  it("accepte plusieurs catégories", () => {
    const r = expenseInputSchema.safeParse({ ...base, amounts: [{ categoryId: "alimentation", amountCents: 1200 }, { categoryId: "transport", amountCents: 500 }] });
    expect(r.success).toBe(true);
  });
  it("étranger sans ville", () => {
    const r = expenseInputSchema.safeParse({ ...base, location: { type: "abroad", countryCode: "MA", countryName: "Maroc" }, amounts: [{ categoryId: "loisirs", amountCents: 100 }] });
    expect(r.success).toBe(true);
  });
  it("refuse une catégorie en double", () => {
    const r = expenseInputSchema.safeParse({ ...base, amounts: [{ categoryId: "sante", amountCents: 1 }, { categoryId: "sante", amountCents: 2 }] });
    expect(r.success).toBe(false);
  });
});
