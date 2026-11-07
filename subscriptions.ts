import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { markPaidSchema, subscriptionSchema, subscriptionUpdateSchema } from "../../shared/schemas";
import {
  findDuplicateSubscriptions, renewalAfterPayment, subscriptionCosts, SUBSCRIPTION_FAMILIES, upcomingRenewals,
  type SubscriptionLike,
} from "../../shared/subscriptions";
import { monthlyEquivalentCents, yearlyEquivalentCents } from "../../shared/recurrence";
import type { Frequency } from "../../shared/income";
import type { SubscriptionDTO, SubscriptionsOverviewDTO } from "../../shared/types";
import { loadSettings, localNow } from "../lib/settings";
import { assertSubcategory } from "../lib/classification";
import { paymentLabelFor, singleLineExpense } from "../lib/ledger";

interface Row {
  id: string; name: string; family: SubscriptionDTO["family"]; category_id: SubscriptionDTO["categoryId"]; subcategory_id: string | null;
  amount_cents: number; frequency: SubscriptionDTO["frequency"]; start_date: string | null; renewal_date: string | null;
  payment_method_id: string | null; payment_label: string; status: SubscriptionDTO["status"]; cancelled_on: string | null;
  cancel_notice_days: number | null; cancel_url: string | null; cancel_notes: string | null; notes: string | null; last_paid_on: string | null;
}
const COLS = "id, name, family, category_id, subcategory_id, amount_cents, frequency, start_date, renewal_date, payment_method_id, payment_label, status, cancelled_on, cancel_notice_days, cancel_url, cancel_notes, notes, last_paid_on";

const toDTO = (r: Row): SubscriptionDTO => ({
  id: r.id, name: r.name, family: r.family, categoryId: r.category_id, subcategoryId: r.subcategory_id, amountCents: r.amount_cents,
  frequency: r.frequency, monthlyCents: monthlyEquivalentCents(r.amount_cents, r.frequency), yearlyCents: yearlyEquivalentCents(r.amount_cents, r.frequency),
  startDate: r.start_date, renewalDate: r.renewal_date, paymentMethodId: r.payment_method_id, paymentLabel: r.payment_label, status: r.status,
  cancelledOn: r.cancelled_on, cancelNoticeDays: r.cancel_notice_days, cancelUrl: r.cancel_url, cancelNotes: r.cancel_notes, notes: r.notes, lastPaidOn: r.last_paid_on,
});

const like = (s: SubscriptionDTO): SubscriptionLike => ({
  id: s.id, name: s.name, family: s.family, amountCents: s.amountCents, frequency: s.frequency, status: s.status, renewalDate: s.renewalDate,
});

async function getOne(db: D1Database, userId: string, id: string) {
  const row = await db.prepare(`SELECT ${COLS} FROM subscriptions WHERE id = ? AND user_id = ?`).bind(id, userId).first<Row>();
  if (!row) throw new ApiError(404, "Abonnement introuvable.");
  return row;
}

export const subscriptions = new Hono<AppEnv>()
  .get("/subscriptions", async (c) => {
    const userId = c.get("userId");
    const settings = await loadSettings(c.env.DB, userId);
    const { today } = localNow(settings);
    const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM subscriptions WHERE user_id = ? ORDER BY status = 'cancelled', renewal_date, name`).bind(userId).all<Row>();
    const items = results.map(toDTO);
    const likes = items.map(like);
    const body: SubscriptionsOverviewDTO = {
      items,
      costs: subscriptionCosts(likes),
      upcoming: upcomingRenewals(items, today, 30),
      duplicates: findDuplicateSubscriptions(likes).map((g) => g.map((s) => s.id)),
    };
    return c.json(body);
  })

  .post("/subscriptions", async (c) => {
    const userId = c.get("userId");
    const input = validate(subscriptionSchema, await readJson(c.req));
    const fam = SUBSCRIPTION_FAMILIES.find((f) => f.id === input.family)!;
    const categoryId = input.categoryId ?? fam.categoryId;
    const sub = input.categoryId ? (input.subcategoryId ?? null) : (input.subcategoryId ?? fam.subcategoryId);
    await assertSubcategory(c.env.DB, userId, categoryId, sub);
    const pay = await paymentLabelFor(c.env.DB, userId, input.paymentMethodId);
    if (!pay) throw new ApiError(400, "Moyen de paiement inconnu.");
    const status = input.status ?? "active";
    if (status === "cancelled" && !input.cancelledOn) { /* la date de résiliation est facultative */ }
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, name, family, category_id, subcategory_id, amount_cents, frequency, start_date, renewal_date,
         payment_method_id, payment_label, status, cancelled_on, cancel_notice_days, cancel_url, cancel_notes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, input.name, input.family, categoryId, sub, input.amountCents, input.frequency, input.startDate ?? null,
      input.renewalDate ?? input.startDate ?? null, pay.id, pay.label, status, input.cancelledOn ?? null, input.cancelNoticeDays ?? null,
      input.cancelUrl ?? null, input.cancelNotes || null, input.notes || null).run();
    return c.json(toDTO(await getOne(c.env.DB, userId, id)), 201);
  })

  .patch("/subscriptions/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(subscriptionUpdateSchema, await readJson(c.req));
    const cur = await getOne(c.env.DB, userId, c.req.param("id"));
    const categoryId = input.categoryId ?? cur.category_id;
    const sub = input.subcategoryId !== undefined ? input.subcategoryId : cur.subcategory_id;
    await assertSubcategory(c.env.DB, userId, categoryId, sub);
    let pay = { id: cur.payment_method_id, label: cur.payment_label };
    if (input.paymentMethodId !== undefined) {
      const p = await paymentLabelFor(c.env.DB, userId, input.paymentMethodId);
      if (!p) throw new ApiError(400, "Moyen de paiement inconnu.");
      pay = p;
    }
    const status = input.status ?? cur.status;
    const pick = <T>(v: T | undefined, d: T) => (v !== undefined ? v : d);
    await c.env.DB.prepare(
      `UPDATE subscriptions SET name = ?, family = ?, category_id = ?, subcategory_id = ?, amount_cents = ?, frequency = ?, start_date = ?, renewal_date = ?,
         payment_method_id = ?, payment_label = ?, status = ?, cancelled_on = ?, cancel_notice_days = ?, cancel_url = ?, cancel_notes = ?, notes = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(pick(input.name, cur.name), pick(input.family, cur.family), categoryId, sub, pick(input.amountCents, cur.amount_cents),
      pick(input.frequency, cur.frequency), pick(input.startDate, cur.start_date), pick(input.renewalDate, cur.renewal_date), pay.id, pay.label, status,
      status === "cancelled" ? (pick(input.cancelledOn, cur.cancelled_on) ?? localNow(await loadSettings(c.env.DB, userId)).today) : null,
      pick(input.cancelNoticeDays, cur.cancel_notice_days), pick(input.cancelUrl, cur.cancel_url), pick(input.cancelNotes, cur.cancel_notes) || null,
      pick(input.notes, cur.notes) || null, nowISO(), cur.id, userId).run();
    return c.json(toDTO(await getOne(c.env.DB, userId, cur.id)));
  })

  .delete("/subscriptions/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM subscriptions WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Abonnement introuvable.");
    return c.body(null, 204);
  })

  /** Enregistre le prélèvement (crée une vraie dépense) et avance la date de renouvellement. */
  .post("/subscriptions/:id/pay", async (c) => {
    const userId = c.get("userId");
    const input = validate(markPaidSchema, await readJson(c.req).catch(() => ({})));
    const cur = await getOne(c.env.DB, userId, c.req.param("id"));
    if (cur.status === "cancelled" || cur.status === "paused") throw new ApiError(400, "Cet abonnement n'est pas actif.");
    if (!cur.renewal_date) throw new ApiError(400, "Indiquez d'abord la date de renouvellement.");
    if (input.dueDate && input.dueDate !== cur.renewal_date) throw new ApiError(409, "Ce renouvellement a déjà été enregistré.");
    const settings = await loadSettings(c.env.DB, userId);
    const paidOn = input.paidOn ?? localNow(settings).today;
    const next = renewalAfterPayment(cur.renewal_date, cur.frequency as Frequency, cur.start_date);
    const expense = await singleLineExpense(c.env.DB, userId, {
      date: paidOn, categoryId: cur.category_id, subcategoryId: cur.subcategory_id, amountCents: input.amountCents ?? cur.amount_cents,
      paymentMethodId: cur.payment_method_id, paymentLabel: cur.payment_label, description: cur.name,
    });
    await c.env.DB.batch([
      ...expense,
      c.env.DB.prepare(
        // Un essai gratuit devient actif au premier paiement.
        "UPDATE subscriptions SET renewal_date = ?, last_paid_on = ?, status = CASE WHEN status = 'trial' THEN 'active' ELSE status END, updated_at = ? WHERE id = ? AND user_id = ? AND renewal_date = ?",
      ).bind(next, paidOn, nowISO(), cur.id, userId, cur.renewal_date),
    ]);
    return c.json(toDTO(await getOne(c.env.DB, userId, cur.id)));
  });
