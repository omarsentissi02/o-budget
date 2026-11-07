import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { findPeriodId, getMonthSummary, getOrCreatePeriodId, INCOME_SELECT, toIncomeDTO, type IncomeRow } from "../lib/periods";
import { incomeWriteStatements, resolveIncome, type IncomeFields } from "../lib/incomes";
import { applyDefaultsSchema, incomeCreateSchema, incomeUpdateSchema, monthKey, savingsSchema } from "../../shared/schemas";
import { computeTotals } from "../../shared/finance";
import { isMonthKey, monthRange } from "../../shared/month";
import type { AnalysisMonthDTO } from "../../shared/types";

const SOURCE_LABELS = { alternance: "Alternance", freelance: "Freelance" } as const;

function isUniqueViolation(e: unknown) {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

export const months = new Hono<AppEnv>()
  .get("/months/:month", async (c) => {
    const month = validate(monthKey, c.req.param("month"));
    return c.json(await getMonthSummary(c.env.DB, c.get("userId"), month));
  })

  /**
   * Copie les montants par défaut (Alternance, Freelance) dans le mois s'ils n'y sont pas encore.
   * V2 : par défaut ils sont créés comme revenus ATTENDUS (non comptés comme cash tant qu'ils ne sont pas confirmés).
   * `{ "status": "confirmed" }` reproduit le comportement V1 (revenus directement confirmés).
   */
  .post("/months/:month/apply-defaults", async (c) => {
    const userId = c.get("userId");
    const month = validate(monthKey, c.req.param("month"));
    const raw = await c.req.json().catch(() => ({}));
    const { status } = validate(applyDefaultsSchema, raw ?? {});
    const s = await c.env.DB.prepare("SELECT default_alternance_cents, default_freelance_cents FROM user_settings WHERE user_id = ?")
      .bind(userId)
      .first<{ default_alternance_cents: number; default_freelance_cents: number }>();
    if (!s) throw new ApiError(404, "Paramètres introuvables.");
    const periodId = await getOrCreatePeriodId(c.env.DB, userId, month);
    const stmts = (["alternance", "freelance"] as const).flatMap((source) => {
      const id = uuid();
      const cents = source === "alternance" ? s.default_alternance_cents : s.default_freelance_cents;
      return [
        c.env.DB.prepare(
          `INSERT INTO incomes (id, user_id, period_id, source, label, amount_cents)
           SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM incomes WHERE period_id = ? AND source = ?)`,
        ).bind(id, userId, periodId, source, SOURCE_LABELS[source], cents, periodId, source),
        // Les détails ne sont écrits que pour la ligne qu'on vient d'insérer (jamais pour un revenu V1 existant).
        c.env.DB.prepare(
          `INSERT INTO income_details (income_id, user_id, kind, status, frequency)
           SELECT id, user_id, ?, ?, 'monthly' FROM incomes WHERE id = ?`,
        ).bind(source, status, id),
      ];
    });
    await c.env.DB.batch(stmts);
    return c.json(await getMonthSummary(c.env.DB, userId, month));
  })

  .post("/incomes", async (c) => {
    const userId = c.get("userId");
    const input = validate(incomeCreateSchema, await readJson(c.req));
    const source = input.source ?? (input.kind === "alternance" || input.kind === "freelance" ? input.kind : "other");
    const fields: IncomeFields = {
      label: input.label,
      source,
      kind: input.kind ?? (source === "other" ? "other" : source),
      status: input.status ?? "confirmed",
      frequency: input.frequency ?? "once",
      amountCents: input.amountCents,
      receivedOn: input.receivedOn ?? null,
      expectedDate: input.expectedDate ?? null,
      grossCents: input.grossCents ?? null,
      employeeContributionsCents: input.employeeContributionsCents ?? null,
      otherDeductionsCents: input.otherDeductionsCents ?? null,
      withholdingCents: input.withholdingCents ?? null,
      organization: input.organization || null,
      benefitType: input.benefitType || null,
      estimatedCents: input.estimatedCents ?? null,
      confirmedCents: input.confirmedCents ?? null,
      paidTo: input.paidTo ?? "user",
      thirdPartyName: input.thirdPartyName || null,
      notes: input.notes || null,
    };
    const r = resolveIncome(fields, input.month);
    const periodId = await getOrCreatePeriodId(c.env.DB, userId, input.month);
    const id = uuid();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO incomes (id, user_id, period_id, source, label, amount_cents, received_on) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, userId, periodId, r.source, r.label, r.amountCents, r.receivedOn),
        incomeWriteStatements(c.env.DB, userId, id, r),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, "Ce revenu existe déjà pour ce mois : modifiez-le plutôt.");
      throw e;
    }
    return c.json(await getMonthSummary(c.env.DB, userId, input.month), 201);
  })

  .patch("/incomes/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(incomeUpdateSchema, await readJson(c.req));
    const existingRow = await c.env.DB.prepare(`${INCOME_SELECT} WHERE i.id = ? AND i.user_id = ?`)
      .bind(c.req.param("id"), userId)
      .first<IncomeRow>();
    const monthRow = await c.env.DB.prepare(
      "SELECT p.month FROM incomes i JOIN financial_periods p ON p.id = i.period_id WHERE i.id = ? AND i.user_id = ?",
    )
      .bind(c.req.param("id"), userId)
      .first<{ month: string }>();
    if (!existingRow || !monthRow) throw new ApiError(404, "Revenu introuvable.");
    const cur = toIncomeDTO(existingRow);
    const pick = <T>(next: T | undefined, current: T): T => (next !== undefined ? next : current);
    const fields: IncomeFields = {
      label: pick(input.label, cur.label),
      source: cur.source,
      kind: pick(input.kind, cur.kind),
      status: pick(input.status, cur.status),
      frequency: pick(input.frequency, cur.frequency),
      amountCents: pick(input.amountCents, cur.amountCents),
      receivedOn: pick(input.receivedOn, cur.receivedOn),
      expectedDate: pick(input.expectedDate, cur.expectedDate),
      grossCents: pick(input.grossCents, cur.grossCents),
      employeeContributionsCents: pick(input.employeeContributionsCents, cur.employeeContributionsCents),
      otherDeductionsCents: pick(input.otherDeductionsCents, cur.otherDeductionsCents),
      withholdingCents: pick(input.withholdingCents, cur.withholdingCents),
      organization: pick(input.organization, cur.organization) || null,
      benefitType: pick(input.benefitType, cur.benefitType) || null,
      estimatedCents: pick(input.estimatedCents, cur.estimatedCents),
      confirmedCents: pick(input.confirmedCents, cur.confirmedCents),
      paidTo: pick(input.paidTo, cur.paidTo),
      thirdPartyName: pick(input.thirdPartyName, cur.thirdPartyName) || null,
      notes: pick(input.notes, cur.notes) || null,
    };
    // Repasser un revenu en « attendu » efface sa date de réception (sinon incohérent).
    if (fields.status !== "confirmed" && fields.status !== "completed" && input.receivedOn === undefined) fields.receivedOn = null;
    const r = resolveIncome(fields, monthRow.month);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE incomes SET label = ?, amount_cents = ?, received_on = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(
        r.label, r.amountCents, r.receivedOn, nowISO(), c.req.param("id"), userId,
      ),
      incomeWriteStatements(c.env.DB, userId, c.req.param("id"), r),
    ]);
    return c.json(await getMonthSummary(c.env.DB, userId, monthRow.month));
  })

  .delete("/incomes/:id", async (c) => {
    const userId = c.get("userId");
    const row = await c.env.DB.prepare(
      "SELECT p.month FROM incomes i JOIN financial_periods p ON p.id = i.period_id WHERE i.id = ? AND i.user_id = ?",
    )
      .bind(c.req.param("id"), userId)
      .first<{ month: string }>();
    if (!row) throw new ApiError(404, "Revenu introuvable.");
    await c.env.DB.prepare("DELETE FROM incomes WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
    return c.json(await getMonthSummary(c.env.DB, userId, row.month));
  })

  .put("/months/:month/savings", async (c) => {
    const userId = c.get("userId");
    const month = validate(monthKey, c.req.param("month"));
    const { amountCents } = validate(savingsSchema, await readJson(c.req));
    const periodId = await getOrCreatePeriodId(c.env.DB, userId, month);
    await c.env.DB.prepare(
      `INSERT INTO savings (period_id, user_id, amount_cents, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (period_id) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`,
    )
      .bind(periodId, userId, amountCents, nowISO())
      .run();
    return c.json(await getMonthSummary(c.env.DB, userId, month));
  })

  /** Totaux mensuels pour la comparaison : ?end=2026-11&count=6 (revenus = argent REÇU). */
  .get("/analysis", async (c) => {
    const userId = c.get("userId");
    const end = c.req.query("end") ?? "";
    const count = Number(c.req.query("count") ?? 6);
    if (!isMonthKey(end) || !Number.isInteger(count) || count < 1 || count > 24) {
      throw new ApiError(400, "Période d'analyse invalide.");
    }
    const keys = monthRange(end, count);
    const from = keys[0];
    const db = c.env.DB;
    const [inc, exp, sav] = await db.batch([
      db
        .prepare(
          `SELECT p.month, SUM(i.amount_cents) AS total FROM incomes i JOIN financial_periods p ON p.id = i.period_id
           LEFT JOIN income_details d ON d.income_id = i.id
           WHERE i.user_id = ? AND p.month BETWEEN ? AND ?
             AND COALESCE(d.status, 'confirmed') IN ('confirmed', 'completed') AND COALESCE(d.paid_to, 'user') = 'user'
           GROUP BY p.month`,
        )
        .bind(userId, from, end),
      db
        .prepare(
          `SELECT p.month, SUM(a.amount_cents) AS total FROM expense_amounts a
           JOIN expense_entries e ON e.id = a.entry_id JOIN financial_periods p ON p.id = e.period_id
           WHERE e.user_id = ? AND p.month BETWEEN ? AND ? GROUP BY p.month`,
        )
        .bind(userId, from, end),
      db
        .prepare(
          `SELECT p.month, s.amount_cents AS total FROM savings s JOIN financial_periods p ON p.id = s.period_id
           WHERE s.user_id = ? AND p.month BETWEEN ? AND ?`,
        )
        .bind(userId, from, end),
    ]);
    const toMap = (r: D1Result) => new Map((r.results as { month: string; total: number }[]).map((x) => [x.month, x.total]));
    const [mi, me, ms] = [toMap(inc), toMap(exp), toMap(sav)];
    const result: AnalysisMonthDTO[] = keys.map((m) => ({
      month: m,
      ...computeTotals([mi.get(m) ?? 0], [me.get(m) ?? 0], ms.get(m) ?? 0),
    }));
    return c.json(result);
  })

  .get("/months/:month/exists", async (c) => {
    const month = validate(monthKey, c.req.param("month"));
    return c.json({ exists: !!(await findPeriodId(c.env.DB, c.get("userId"), month)) });
  });
