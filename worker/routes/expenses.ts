import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { getEntry, getOrCreatePeriodId, listEntriesForMonth } from "../lib/periods";
import { expenseInputSchema, monthKey, type ExpenseInput } from "../../shared/schemas";
import { monthKeyFromDate } from "../../shared/month";

async function resolvePayment(db: D1Database, userId: string, id: string | null) {
  if (id === null) return { id: null, label: "Autre" };
  const row = await db.prepare("SELECT name FROM payment_methods WHERE id = ? AND user_id = ?").bind(id, userId).first<{ name: string }>();
  if (!row) throw new ApiError(400, "Moyen de paiement inconnu.");
  return { id, label: row.name };
}

function locationColumns(input: ExpenseInput) {
  const l = input.location;
  return l.type === "france"
    ? { type: "france", code: "FR", country: "France", city: l.city }
    : { type: "abroad", code: l.countryCode, country: l.countryName, city: null };
}

function amountInserts(db: D1Database, entryId: string, input: ExpenseInput) {
  return input.amounts.map((a) =>
    db
      .prepare("INSERT INTO expense_amounts (id, entry_id, category_id, amount_cents) VALUES (?, ?, ?, ?)")
      .bind(uuid(), entryId, a.categoryId, a.amountCents),
  );
}

export const expenses = new Hono<AppEnv>()
  .get("/expenses", async (c) => {
    const month = validate(monthKey, c.req.query("month") ?? "");
    return c.json(await listEntriesForMonth(c.env.DB, c.get("userId"), month));
  })

  .get("/expenses/:id", async (c) => {
    const entry = await getEntry(c.env.DB, c.get("userId"), c.req.param("id"));
    if (!entry) throw new ApiError(404, "Dépense introuvable.");
    return c.json(entry);
  })

  .post("/expenses", async (c) => {
    const userId = c.get("userId");
    const db = c.env.DB;
    const input = validate(expenseInputSchema, await readJson(c.req));

    // Anti double-envoi : même identifiant client → on renvoie la dépense déjà créée.
    const findExisting = async () =>
      input.clientRequestId
        ? db
            .prepare("SELECT id FROM expense_entries WHERE user_id = ? AND client_request_id = ?")
            .bind(userId, input.clientRequestId)
            .first<{ id: string }>()
        : null;
    const existing = await findExisting();
    if (existing) return c.json(await getEntry(db, userId, existing.id), 200);

    const payment = await resolvePayment(db, userId, input.paymentMethodId);
    const periodId = await getOrCreatePeriodId(db, userId, monthKeyFromDate(input.date));
    const loc = locationColumns(input);
    const id = uuid();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO expense_entries (id, user_id, period_id, spent_on, location_type, country_code, country_name, city,
               payment_method_id, payment_label, description, client_request_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, userId, periodId, input.date, loc.type, loc.code, loc.country, loc.city, payment.id, payment.label,
            input.description || null, input.clientRequestId ?? null),
        ...amountInserts(db, id, input),
      ]);
    } catch (e) {
      const dup = await findExisting();
      if (dup) return c.json(await getEntry(db, userId, dup.id), 200);
      throw e;
    }
    return c.json(await getEntry(db, userId, id), 201);
  })

  .put("/expenses/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.env.DB;
    const id = c.req.param("id");
    const input = validate(expenseInputSchema, await readJson(c.req));
    const owned = await db.prepare("SELECT 1 FROM expense_entries WHERE id = ? AND user_id = ?").bind(id, userId).first();
    if (!owned) throw new ApiError(404, "Dépense introuvable.");
    const payment = await resolvePayment(db, userId, input.paymentMethodId);
    const periodId = await getOrCreatePeriodId(db, userId, monthKeyFromDate(input.date));
    const loc = locationColumns(input);
    await db.batch([
      db
        .prepare(
          `UPDATE expense_entries SET period_id = ?, spent_on = ?, location_type = ?, country_code = ?, country_name = ?, city = ?,
             payment_method_id = ?, payment_label = ?, description = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .bind(periodId, input.date, loc.type, loc.code, loc.country, loc.city, payment.id, payment.label,
          input.description || null, nowISO(), id, userId),
      db.prepare("DELETE FROM expense_amounts WHERE entry_id = ?").bind(id),
      ...amountInserts(db, id, input),
    ]);
    return c.json(await getEntry(db, userId, id));
  })

  .delete("/expenses/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM expense_entries WHERE id = ? AND user_id = ?")
      .bind(c.req.param("id"), c.get("userId"))
      .run();
    if (!res.meta.changes) throw new ApiError(404, "Dépense introuvable.");
    return c.body(null, 204);
  });
