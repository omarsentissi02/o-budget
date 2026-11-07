import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import {
  budgetCopySchema, budgetUpsertSchema, contributionSchema, goalSchema, goalUpdateSchema, markPaidSchema, monthKey,
  recurringItemSchema, recurringItemUpdateSchema,
} from "../../shared/schemas";
import { SELECTABLE_CATEGORIES } from "../../shared/categories";
import { budgetStatus, forecastMonths, requiredMonthlySaving, NON_VARIABLE_CATEGORIES } from "../../shared/budget";
import { nextAfter, parseISO, addMonthsISO } from "../../shared/recurrence";
import { loadSettings, localNow } from "../lib/settings";
import { getMonthSummary } from "../lib/periods";
import { assertSubcategory } from "../lib/classification";
import { paymentLabelFor, singleLineExpense } from "../lib/ledger";
import { loadMonthFacts } from "../lib/data";
import type { BudgetRowDTO, ContributionDTO, ForecastDTO, GoalDTO, RecurringItemDTO } from "../../shared/types";
import type { Frequency } from "../../shared/income";

// ---- Budgets ---------------------------------------------------------------------------------------------
export const budgets = new Hono<AppEnv>()
  .get("/budgets", async (c) => {
    const userId = c.get("userId");
    const month = validate(monthKey, c.req.query("month") ?? "");
    const [limits, summary, settings] = await Promise.all([
      c.env.DB.prepare("SELECT category_id, limit_cents FROM budgets WHERE user_id = ? AND month = ?").bind(userId, month).all<{ category_id: string; limit_cents: number }>(),
      getMonthSummary(c.env.DB, userId, month),
      loadSettings(c.env.DB, userId),
    ]);
    const limitBy = new Map(limits.results.map((l) => [l.category_id, l.limit_cents]));
    const spentBy = new Map(summary.categories.map((x) => [x.categoryId as string, x.amountCents]));
    const rows: BudgetRowDTO[] = [];
    for (const cat of SELECTABLE_CATEGORIES) {
      const limit = limitBy.get(cat.id) ?? null;
      const spent = spentBy.get(cat.id) ?? 0;
      if (limit === null && spent === 0) continue;
      rows.push({ categoryId: cat.id, limitCents: limit, status: budgetStatus(spent, limit, settings.alertPrefs.budgetWarnAt) });
    }
    // Catégories héritées de la V1 (« autre ») dépensées mais non sélectionnables : visibles pour ne rien cacher.
    const legacySpent = spentBy.get("autre") ?? 0;
    if (legacySpent > 0) rows.push({ categoryId: "autre", limitCents: limitBy.get("autre") ?? null, status: budgetStatus(legacySpent, limitBy.get("autre") ?? null) });
    rows.sort((a, b) => (b.status.spentCents - a.status.spentCents) || (a.categoryId < b.categoryId ? -1 : 1));
    const totalLimit = rows.reduce((s, r) => s + (r.limitCents ?? 0), 0);
    const totalSpentBudgeted = rows.filter((r) => r.limitCents !== null).reduce((s, r) => s + r.status.spentCents, 0);
    return c.json({ month, rows, totalLimitCents: totalLimit, totalSpentOnBudgetedCents: totalSpentBudgeted });
  })

  .put("/budgets", async (c) => {
    const userId = c.get("userId");
    const input = validate(budgetUpsertSchema, await readJson(c.req));
    await c.env.DB.prepare(
      `INSERT INTO budgets (id, user_id, category_id, month, limit_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, category_id, month) DO UPDATE SET limit_cents = excluded.limit_cents, updated_at = excluded.updated_at`,
    ).bind(uuid(), userId, input.categoryId, input.month, input.limitCents, nowISO()).run();
    return c.body(null, 204);
  })

  .delete("/budgets/:month/:categoryId", async (c) => {
    const month = validate(monthKey, c.req.param("month"));
    await c.env.DB.prepare("DELETE FROM budgets WHERE user_id = ? AND month = ? AND category_id = ?").bind(c.get("userId"), month, c.req.param("categoryId")).run();
    return c.body(null, 204);
  })

  /** Copie les limites d'un mois vers un autre, sans écraser celles déjà définies. */
  .post("/budgets/copy", async (c) => {
    const userId = c.get("userId");
    const { fromMonth, toMonth } = validate(budgetCopySchema, await readJson(c.req));
    if (fromMonth === toMonth) throw new ApiError(400, "Choisissez deux mois différents.");
    const res = await c.env.DB.prepare(
      `INSERT INTO budgets (id, user_id, category_id, month, limit_cents)
       SELECT lower(hex(randomblob(16))), user_id, category_id, ?, limit_cents FROM budgets WHERE user_id = ? AND month = ?
       ON CONFLICT (user_id, category_id, month) DO NOTHING`,
    ).bind(toMonth, userId, fromMonth).run();
    return c.json({ copied: res.meta.changes });
  });

// ---- Charges fixes / récurrentes ------------------------------------------------------------------------------
interface RecurringRow {
  id: string; label: string; amount_cents: number; frequency: RecurringItemDTO["frequency"]; next_due_date: string; anchor_date: string;
  end_date: string | null; category_id: RecurringItemDTO["categoryId"]; subcategory_id: string | null; payment_method_id: string | null;
  payment_label: string; active: number; last_paid_on: string | null; notes: string | null;
}
const toRecurring = (r: RecurringRow): RecurringItemDTO => ({
  id: r.id, label: r.label, amountCents: r.amount_cents, frequency: r.frequency, nextDueDate: r.next_due_date, endDate: r.end_date,
  categoryId: r.category_id, subcategoryId: r.subcategory_id, paymentMethodId: r.payment_method_id, paymentLabel: r.payment_label,
  active: r.active === 1, lastPaidOn: r.last_paid_on, notes: r.notes,
});
const RECURRING_COLS = "id, label, amount_cents, frequency, next_due_date, anchor_date, end_date, category_id, subcategory_id, payment_method_id, payment_label, active, last_paid_on, notes";

export const recurring = new Hono<AppEnv>()
  .get("/recurring", async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT ${RECURRING_COLS} FROM recurring_items WHERE user_id = ? ORDER BY active DESC, next_due_date`).bind(c.get("userId")).all<RecurringRow>();
    return c.json(results.map(toRecurring));
  })

  .post("/recurring", async (c) => {
    const userId = c.get("userId");
    const input = validate(recurringItemSchema, await readJson(c.req));
    await assertSubcategory(c.env.DB, userId, input.categoryId, input.subcategoryId);
    const pay = await paymentLabelFor(c.env.DB, userId, input.paymentMethodId);
    if (!pay) throw new ApiError(400, "Moyen de paiement inconnu.");
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO recurring_items (id, user_id, label, amount_cents, frequency, next_due_date, anchor_date, end_date, category_id, subcategory_id,
         payment_method_id, payment_label, active, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, input.label, input.amountCents, input.frequency, input.nextDueDate, input.nextDueDate, input.endDate ?? null, input.categoryId,
      input.subcategoryId ?? null, pay.id, pay.label, input.active === false ? 0 : 1, input.notes || null).run();
    const row = await c.env.DB.prepare(`SELECT ${RECURRING_COLS} FROM recurring_items WHERE id = ?`).bind(id).first<RecurringRow>();
    return c.json(toRecurring(row!), 201);
  })

  .patch("/recurring/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(recurringItemUpdateSchema, await readJson(c.req));
    const cur = await c.env.DB.prepare(`SELECT ${RECURRING_COLS} FROM recurring_items WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), userId).first<RecurringRow>();
    if (!cur) throw new ApiError(404, "Charge introuvable.");
    const categoryId = input.categoryId ?? cur.category_id;
    const sub = input.subcategoryId !== undefined ? input.subcategoryId : cur.subcategory_id;
    await assertSubcategory(c.env.DB, userId, categoryId, sub);
    let pay = { id: cur.payment_method_id, label: cur.payment_label };
    if (input.paymentMethodId !== undefined) {
      const p = await paymentLabelFor(c.env.DB, userId, input.paymentMethodId);
      if (!p) throw new ApiError(400, "Moyen de paiement inconnu.");
      pay = p;
    }
    const next = input.nextDueDate ?? cur.next_due_date;
    await c.env.DB.prepare(
      `UPDATE recurring_items SET label = ?, amount_cents = ?, frequency = ?, next_due_date = ?, anchor_date = ?, end_date = ?, category_id = ?, subcategory_id = ?,
         payment_method_id = ?, payment_label = ?, active = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(input.label ?? cur.label, input.amountCents ?? cur.amount_cents, input.frequency ?? cur.frequency, next,
      input.nextDueDate ? input.nextDueDate : cur.anchor_date, input.endDate !== undefined ? input.endDate : cur.end_date, categoryId, sub,
      pay.id, pay.label, input.active === undefined ? cur.active : input.active ? 1 : 0, input.notes !== undefined ? input.notes || null : cur.notes,
      nowISO(), c.req.param("id"), userId).run();
    const row = await c.env.DB.prepare(`SELECT ${RECURRING_COLS} FROM recurring_items WHERE id = ?`).bind(c.req.param("id")).first<RecurringRow>();
    return c.json(toRecurring(row!));
  })

  .delete("/recurring/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM recurring_items WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Charge introuvable.");
    return c.body(null, 204);
  })

  /** Marque l'échéance courante comme payée : crée UNE dépense réelle puis avance l'échéance. */
  .post("/recurring/:id/pay", async (c) => {
    const userId = c.get("userId");
    const input = validate(markPaidSchema, await readJson(c.req).catch(() => ({})));
    const cur = await c.env.DB.prepare(`SELECT ${RECURRING_COLS} FROM recurring_items WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), userId).first<RecurringRow>();
    if (!cur) throw new ApiError(404, "Charge introuvable.");
    if (input.dueDate && input.dueDate !== cur.next_due_date) throw new ApiError(409, "Cette échéance a déjà été réglée.");
    const settings = await loadSettings(c.env.DB, userId);
    const paidOn = input.paidOn ?? localNow(settings).today;
    const next = nextAfter(cur.anchor_date, cur.frequency as Frequency, cur.next_due_date);
    const finished = next === null || (cur.end_date !== null && next > cur.end_date);
    const expense = await singleLineExpense(c.env.DB, userId, {
      date: paidOn, categoryId: cur.category_id, subcategoryId: cur.subcategory_id, amountCents: input.amountCents ?? cur.amount_cents,
      paymentMethodId: cur.payment_method_id, paymentLabel: cur.payment_label, description: cur.label,
    });
    await c.env.DB.batch([
      ...expense,
      c.env.DB.prepare("UPDATE recurring_items SET next_due_date = ?, active = ?, last_paid_on = ?, updated_at = ? WHERE id = ? AND user_id = ? AND next_due_date = ?")
        .bind(finished ? cur.next_due_date : next, finished ? 0 : cur.active, paidOn, nowISO(), cur.id, userId, cur.next_due_date),
    ]);
    const row = await c.env.DB.prepare(`SELECT ${RECURRING_COLS} FROM recurring_items WHERE id = ?`).bind(cur.id).first<RecurringRow>();
    return c.json(toRecurring(row!));
  });

// ---- Épargne : objectifs, réserves ------------------------------------------------------------------------------
async function loadGoals(db: D1Database, userId: string, today: string): Promise<GoalDTO[]> {
  const { results } = await db.prepare(
    `SELECT g.id, g.name, g.target_cents, g.deadline, g.monthly_target_cents, g.is_reserve, g.archived, g.notes,
       COALESCE((SELECT SUM(amount_cents) FROM goal_contributions c WHERE c.goal_id = g.id AND c.user_id = g.user_id), 0) AS saved
     FROM savings_goals g WHERE g.user_id = ? ORDER BY g.archived, g.is_reserve DESC, g.created_at`,
  ).bind(userId).all<{ id: string; name: string; target_cents: number; deadline: string | null; monthly_target_cents: number | null; is_reserve: number; archived: number; notes: string | null; saved: number }>();
  return results.map((g) => ({
    id: g.id, name: g.name, targetCents: g.target_cents, savedCents: g.saved, deadline: g.deadline, monthlyTargetCents: g.monthly_target_cents,
    isReserve: g.is_reserve === 1, archived: g.archived === 1, notes: g.notes,
    progress: Math.max(0, Math.min(1, g.saved / g.target_cents)),
    requiredMonthlyCents: requiredMonthlySaving(g.target_cents, g.saved, today, g.deadline),
  }));
}

export const goals = new Hono<AppEnv>()
  .get("/goals", async (c) => {
    const userId = c.get("userId");
    const settings = await loadSettings(c.env.DB, userId);
    const list = await loadGoals(c.env.DB, userId, localNow(settings).today);
    const active = list.filter((g) => !g.archived);
    return c.json({
      goals: list,
      reservesCents: active.filter((g) => g.isReserve).reduce((s, g) => s + g.savedCents, 0),
      totalSavedCents: active.reduce((s, g) => s + g.savedCents, 0),
    });
  })

  .post("/goals", async (c) => {
    const userId = c.get("userId");
    const input = validate(goalSchema, await readJson(c.req));
    const id = uuid();
    await c.env.DB.prepare(
      "INSERT INTO savings_goals (id, user_id, name, target_cents, deadline, monthly_target_cents, is_reserve, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, userId, input.name, input.targetCents, input.deadline ?? null, input.monthlyTargetCents ?? null, input.isReserve ? 1 : 0, input.notes || null).run();
    const settings = await loadSettings(c.env.DB, userId);
    return c.json((await loadGoals(c.env.DB, userId, localNow(settings).today)).find((g) => g.id === id), 201);
  })

  .patch("/goals/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(goalUpdateSchema, await readJson(c.req));
    const cur = await c.env.DB.prepare("SELECT * FROM savings_goals WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).first<Record<string, unknown>>();
    if (!cur) throw new ApiError(404, "Objectif introuvable.");
    await c.env.DB.prepare(
      `UPDATE savings_goals SET name = ?, target_cents = ?, deadline = ?, monthly_target_cents = ?, is_reserve = ?, archived = ?, notes = ? WHERE id = ? AND user_id = ?`,
    ).bind(input.name ?? cur.name, input.targetCents ?? cur.target_cents, input.deadline !== undefined ? input.deadline : cur.deadline,
      input.monthlyTargetCents !== undefined ? input.monthlyTargetCents : cur.monthly_target_cents,
      input.isReserve === undefined ? cur.is_reserve : input.isReserve ? 1 : 0, input.archived === undefined ? cur.archived : input.archived ? 1 : 0,
      input.notes !== undefined ? input.notes || null : cur.notes, c.req.param("id"), userId).run();
    const settings = await loadSettings(c.env.DB, userId);
    return c.json((await loadGoals(c.env.DB, userId, localNow(settings).today)).find((g) => g.id === c.req.param("id")));
  })

  .delete("/goals/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM savings_goals WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Objectif introuvable.");
    return c.body(null, 204);
  })

  .get("/goals/:id/contributions", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, goal_id, amount_cents, contributed_on, note FROM goal_contributions WHERE goal_id = ? AND user_id = ? ORDER BY contributed_on DESC, created_at DESC",
    ).bind(c.req.param("id"), c.get("userId")).all<{ id: string; goal_id: string; amount_cents: number; contributed_on: string; note: string | null }>();
    const out: ContributionDTO[] = results.map((r) => ({ id: r.id, goalId: r.goal_id, amountCents: r.amount_cents, contributedOn: r.contributed_on, note: r.note }));
    return c.json(out);
  })

  .post("/goals/:id/contributions", async (c) => {
    const userId = c.get("userId");
    const input = validate(contributionSchema, await readJson(c.req));
    const goal = await c.env.DB.prepare("SELECT 1 FROM savings_goals WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).first();
    if (!goal) throw new ApiError(404, "Objectif introuvable.");
    if (input.amountCents < 0) {
      const saved = await c.env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM goal_contributions WHERE goal_id = ? AND user_id = ?").bind(c.req.param("id"), userId).first<{ s: number }>();
      if ((saved?.s ?? 0) + input.amountCents < 0) throw new ApiError(400, "Le retrait dépasse le montant épargné.");
    }
    await c.env.DB.prepare("INSERT INTO goal_contributions (id, user_id, goal_id, amount_cents, contributed_on, note) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(uuid(), userId, c.req.param("id"), input.amountCents, input.contributedOn, input.note || null).run();
    const settings = await loadSettings(c.env.DB, userId);
    return c.json((await loadGoals(c.env.DB, userId, localNow(settings).today)).find((g) => g.id === c.req.param("id")), 201);
  })

  .delete("/contributions/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM goal_contributions WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Versement introuvable.");
    return c.body(null, 204);
  });

// ---- Prévision de trésorerie ------------------------------------------------------------------------------------------
export const forecast = new Hono<AppEnv>().get("/forecast", async (c) => {
  const userId = c.get("userId");
  const count = Math.min(6, Math.max(1, Number(c.req.query("count") ?? 3) || 3));
  const settings = await loadSettings(c.env.DB, userId);
  const { today } = localNow(settings);
  const month = today.slice(0, 7);
  const facts = await loadMonthFacts(c.env.DB, userId, month, settings, today);
  const startMonth = addMonthsISO(`${month}-01`, 1).slice(0, 7);

  // Dépense variable moyenne : 3 derniers mois COMPLETS (hors charges fixes), uniquement si de l'historique existe.
  const from = addMonthsISO(`${month}-01`, -3);
  const marks = NON_VARIABLE_CATEGORIES.map(() => "?").join(",");
  const hist = await c.env.DB.prepare(
    `SELECT substr(e.spent_on, 1, 7) AS m, SUM(a.amount_cents) AS total FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
     WHERE e.user_id = ? AND e.spent_on >= ? AND e.spent_on < ? AND a.category_id NOT IN (${marks}) GROUP BY m`,
  ).bind(userId, from, `${month}-01`, ...NON_VARIABLE_CATEGORIES).all<{ m: string; total: number }>();
  const avgVariable = hist.results.length ? Math.round(hist.results.reduce((s, r) => s + r.total, 0) / hist.results.length) : 0;

  // Revenus récurrents attendus : dernier revenu récurrent par (type, libellé) — évite de compter deux fois le même salaire.
  const incRows = await c.env.DB.prepare(
    `SELECT d.kind, i.label, i.amount_cents, d.frequency, COALESCE(i.received_on, d.expected_date, p.month || '-01') AS anchor
     FROM incomes i JOIN income_details d ON d.income_id = i.id JOIN financial_periods p ON p.id = i.period_id
     WHERE i.user_id = ? AND d.frequency <> 'once' AND d.status NOT IN ('suspended', 'cancelled') AND d.paid_to = 'user'
     ORDER BY anchor DESC`,
  ).bind(userId).all<{ kind: string; label: string; amount_cents: number; frequency: Frequency; anchor: string }>();
  const seen = new Set<string>();
  const incomes = incRows.results.filter((r) => {
    const k = `${r.kind}|${r.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((r) => {
    // Projette l'ancre au 1er mois de prévision en gardant le jour du mois.
    const anchorDay = parseISO(r.anchor).d;
    return { label: r.label, amountCents: r.amount_cents, nextDate: addMonthsISO(`${startMonth}-01`, 0, anchorDay), frequency: r.frequency };
  });

  const obligations = [
    ...(await c.env.DB.prepare("SELECT name AS label, amount_cents, frequency, renewal_date AS d FROM subscriptions WHERE user_id = ? AND status IN ('active','trial') AND renewal_date IS NOT NULL").bind(userId).all<{ label: string; amount_cents: number; frequency: Frequency; d: string }>()).results,
    ...(await c.env.DB.prepare("SELECT label, amount_cents, frequency, next_due_date AS d FROM recurring_items WHERE user_id = ? AND active = 1").bind(userId).all<{ label: string; amount_cents: number; frequency: Frequency; d: string }>()).results,
  ].map((o) => ({ label: o.label, amountCents: o.amount_cents, nextDate: o.d, frequency: o.frequency }));

  const body: ForecastDTO = {
    startingCashCents: facts.position.projectedEndCashCents,
    months: forecastMonths({
      startMonth, count, startingCashCents: facts.position.projectedEndCashCents, incomes, obligations,
      avgVariableSpendCents: avgVariable, plannedSavingsCents: settings.monthlySavingsTargetCents,
    }),
    basis: { avgVariableSpendCents: avgVariable, plannedSavingsCents: settings.monthlySavingsTargetCents, incomeSources: incomes.length, obligationSources: obligations.length },
  };
  return c.json(body);
});

