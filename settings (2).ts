import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { deleteDataSchema, paymentMethodCreateSchema, paymentMethodUpdateSchema, settingsUpdateSchema } from "../../shared/schemas";
import { loadMe } from "./auth";

export const settings = new Hono<AppEnv>()
  .patch("/settings", async (c) => {
    const userId = c.get("userId");
    const input = validate(settingsUpdateSchema, await readJson(c.req));
    const hasOpening = input.openingBalanceCents !== undefined || input.openingBalanceMonth !== undefined;
    if (hasOpening && (input.openingBalanceCents === null) !== (input.openingBalanceMonth === null)) {
      throw new ApiError(400, "Indiquez à la fois le solde de départ et son mois (ou ni l'un ni l'autre).");
    }
    if (hasOpening && (input.openingBalanceCents === undefined || input.openingBalanceMonth === undefined)) {
      throw new ApiError(400, "Indiquez à la fois le solde de départ et son mois.");
    }
    // Seuls les montants PAR DÉFAUT changent : les revenus des mois existants sont des copies indépendantes.
    await c.env.DB.prepare(
      `UPDATE user_settings SET
         default_alternance_cents = COALESCE(?, default_alternance_cents),
         default_freelance_cents  = COALESCE(?, default_freelance_cents),
         theme = COALESCE(?, theme),
         timezone = COALESCE(?, timezone),
         safety_reserve_cents = COALESCE(?, safety_reserve_cents),
         monthly_savings_target_cents = COALESCE(?, monthly_savings_target_cents),
         opening_balance_cents = CASE WHEN ? THEN ? ELSE opening_balance_cents END,
         opening_balance_month = CASE WHEN ? THEN ? ELSE opening_balance_month END,
         alert_prefs = COALESCE(?, alert_prefs),
         ai_share_detail = COALESCE(?, ai_share_detail),
         updated_at = ?
       WHERE user_id = ?`,
    )
      .bind(
        input.defaultAlternanceCents ?? null,
        input.defaultFreelanceCents ?? null,
        input.theme ?? null,
        input.timezone ?? null,
        input.safetyReserveCents ?? null,
        input.monthlySavingsTargetCents ?? null,
        hasOpening ? 1 : 0,
        input.openingBalanceCents ?? null,
        hasOpening ? 1 : 0,
        input.openingBalanceMonth ?? null,
        input.alertPrefs ? JSON.stringify(input.alertPrefs) : null,
        input.aiShareDetail === undefined ? null : input.aiShareDetail ? 1 : 0,
        nowISO(),
        userId,
      )
      .run();
    return c.json(await loadMe(c.env.DB, userId));
  })

  .post("/payment-methods", async (c) => {
    const userId = c.get("userId");
    const { name } = validate(paymentMethodCreateSchema, await readJson(c.req));
    const dup = await c.env.DB.prepare("SELECT 1 FROM payment_methods WHERE user_id = ? AND name = ? COLLATE NOCASE AND archived = 0")
      .bind(userId, name)
      .first();
    if (dup) throw new ApiError(409, "Ce moyen de paiement existe déjà.");
    await c.env.DB.prepare(
      "INSERT INTO payment_methods (id, user_id, name, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM payment_methods WHERE user_id = ?))",
    )
      .bind(uuid(), userId, name, userId)
      .run();
    return c.json(await loadMe(c.env.DB, userId), 201);
  })

  .patch("/payment-methods/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(paymentMethodUpdateSchema, await readJson(c.req));
    // Les dépenses conservent le libellé du moyen de paiement au moment de la saisie.
    const res = await c.env.DB.prepare(
      "UPDATE payment_methods SET name = COALESCE(?, name), archived = COALESCE(?, archived) WHERE id = ? AND user_id = ?",
    )
      .bind(input.name ?? null, input.archived === undefined ? null : input.archived ? 1 : 0, c.req.param("id"), userId)
      .run();
    if (!res.meta.changes) throw new ApiError(404, "Moyen de paiement introuvable.");
    return c.json(await loadMe(c.env.DB, userId));
  })

  /** Suppression de données de l'utilisateur, par périmètre. Les cascades de clés étrangères font le reste. */
  .delete("/data", async (c) => {
    const { scope } = validate(deleteDataSchema, await readJson(c.req));
    const userId = c.get("userId");
    const db = c.env.DB;
    const stmts: D1PreparedStatement[] = [];
    if (scope === "finance" || scope === "all") {
      stmts.push(
        db.prepare("DELETE FROM financial_periods WHERE user_id = ?").bind(userId), // revenus, détails, épargne, dépenses
        db.prepare("DELETE FROM budgets WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM recurring_items WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM subscriptions WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM savings_goals WHERE user_id = ?").bind(userId), // + versements
        db.prepare("DELETE FROM merchants WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM merchant_prefs WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM subcategories WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(userId),
      );
    }
    if (scope === "tasks" || scope === "all") {
      stmts.push(db.prepare("DELETE FROM tasks WHERE user_id = ?").bind(userId), db.prepare("DELETE FROM task_categories WHERE user_id = ?").bind(userId));
    }
    if (scope === "assistant" || scope === "all") {
      stmts.push(db.prepare("DELETE FROM ai_messages WHERE user_id = ?").bind(userId));
    }
    await db.batch(stmts);
    return c.body(null, 204);
  });
