import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { findPeriodId, getMonthSummary, getOrCreatePeriodId } from "../lib/periods";
import { incomeCreateSchema, incomeUpdateSchema, monthKey, savingsSchema } from "../../shared/schemas";
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

  /** Copie les montants par défaut (Alternance, Freelance) dans le mois s'ils n'y sont pas encore. */
  .post("/months/:month/apply-defaults", async (c) => {
    const userId = c.get("userId");
    const month = validate(monthKey, c.req.param("month"));
    const s = await c.env.DB.prepare("SELECT default_alternance_cents, default_freelance_cents FROM user_settings WHERE user_id = ?")
      .bind(userId)
      .first<{ default_alternance_cents: number; default_freelance_cents: number }>();
    if (!s) throw new ApiError(404, "Paramètres introuvables.");
    const periodId = await getOrCreatePeriodId(c.env.DB, userId, month);
    const insert = (source: "alternance" | "freelance", cents: number) =>
      c.env.DB.prepare(
        `INSERT INTO incomes (id, user_id, period_id, source, label, amount_cents)
         SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM incomes WHERE period_id = ? AND source = ?)`,
      ).bind(uuid(), userId, periodId, source, SOURCE_LABELS[source], cents, periodId, source);
    await c.env.DB.batch([
      insert("alternance", s.default_alternance_cents),
      insert("freelance", s.default_freelance_cents),
    ]);
    return c.json(await getMonthSummary(c.env.DB, userId, month));
  })

  .post("/incomes", async (c) => {
    const userId = c.get("userId");
    const input = validate(incomeCreateSchema, await readJson(c.req));
    if (input.receivedOn && !input.receivedOn.startsWith(input.month)) {
      throw new ApiError(400, "La date doit se situer dans le mois choisi.");
    }
    const periodId = await getOrCreatePeriodId(c.env.DB, userId, input.month);
    try {
      await c.env.DB.prepare(
        "INSERT INTO incomes (id, user_id, period_id, source, label, amount_cents, received_on) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(uuid(), userId, periodId, input.source, input.label, input.amountCents, input.receivedOn ?? null)
        .run();
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, "Ce revenu existe déjà pour ce mois : modifiez-le plutôt.");
      throw e;
    }
    return c.json(await getMonthSummary(c.env.DB, userId, input.month), 201);
  })

  .patch("/incomes/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(incomeUpdateSchema, await readJson(c.req));
    const row = await c.env.DB.prepare(
      "SELECT p.month FROM incomes i JOIN financial_periods p ON p.id = i.period_id WHERE i.id = ? AND i.user_id = ?",
    )
      .bind(c.req.param("id"), userId)
      .first<{ month: string }>();
    if (!row) throw new ApiError(404, "Revenu introuvable.");
    if (input.receivedOn && !input.receivedOn.startsWith(row.month)) {
      throw new ApiError(400, "La date doit se situer dans le mois du revenu.");
    }
    await c.env.DB.prepare(
      `UPDATE incomes SET label = COALESCE(?, label), amount_cents = COALESCE(?, amount_cents),
         received_on = CASE WHEN ? THEN ? ELSE received_on END, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        input.label ?? null,
        input.amountCents ?? null,
        input.receivedOn !== undefined ? 1 : 0,
        input.receivedOn ?? null,
        nowISO(),
        c.req.param("id"),
        userId,
      )
      .run();
    return c.json(await getMonthSummary(c.env.DB, userId, row.month));
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

  /** Totaux mensuels pour la comparaison : ?end=2026-11&count=6 */
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
           WHERE i.user_id = ? AND p.month BETWEEN ? AND ? GROUP BY p.month`,
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
