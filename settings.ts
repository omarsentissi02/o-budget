import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { deleteDataSchema, paymentMethodCreateSchema, paymentMethodUpdateSchema, settingsUpdateSchema } from "../../shared/schemas";
import { loadMe } from "./auth";

export const settings = new Hono<AppEnv>()
  .patch("/settings", async (c) => {
    const userId = c.get("userId");
    const input = validate(settingsUpdateSchema, await readJson(c.req));
    // Seuls les montants PAR DÉFAUT changent : les revenus des mois existants sont des copies indépendantes.
    await c.env.DB.prepare(
      `UPDATE user_settings SET
         default_alternance_cents = COALESCE(?, default_alternance_cents),
         default_freelance_cents  = COALESCE(?, default_freelance_cents),
         theme = COALESCE(?, theme),
         updated_at = ?
       WHERE user_id = ?`,
    )
      .bind(input.defaultAlternanceCents ?? null, input.defaultFreelanceCents ?? null, input.theme ?? null, nowISO(), userId)
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

  .delete("/data", async (c) => {
    validate(deleteDataSchema, await readJson(c.req));
    // La cascade supprime revenus, épargne, dépenses et montants.
    await c.env.DB.prepare("DELETE FROM financial_periods WHERE user_id = ?").bind(c.get("userId")).run();
    return c.body(null, 204);
  });
