import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { getEntry, getOrCreatePeriodId, listEntriesForMonth } from "../lib/periods";
import { assertSubcategory, resolveMerchant } from "../lib/classification";
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

interface ResolvedLine {
  categoryId: string;
  amountCents: number;
  subcategoryId: string | null;
  merchantId: string | null;
  merchantLabel: string | null;
  platformId: string | null;
  tripFrom: string | null;
  tripTo: string | null;
  tripDate: string | null;
  note: string | null;
}

async function resolveLines(db: D1Database, userId: string, input: ExpenseInput): Promise<ResolvedLine[]> {
  const out: ResolvedLine[] = [];
  for (const l of input.amounts) {
    const sub = await assertSubcategory(db, userId, l.categoryId, l.subcategoryId);
    const merchant = await resolveMerchant(db, userId, l.merchantId);
    out.push({
      categoryId: l.categoryId,
      amountCents: l.amountCents,
      subcategoryId: sub,
      merchantId: merchant?.id ?? null,
      merchantLabel: merchant?.label ?? null,
      platformId: l.platformId ?? null,
      tripFrom: l.tripFrom || null,
      tripTo: l.tripTo || null,
      tripDate: l.tripDate || null,
      note: l.note || null,
    });
  }
  return out;
}

function lineInserts(db: D1Database, entryId: string, lines: ResolvedLine[]) {
  return lines.map((a) =>
    db
      .prepare(
        `INSERT INTO expense_amounts (id, entry_id, category_id, amount_cents, subcategory_id, merchant_id, merchant_label,
           platform_id, trip_from, trip_to, trip_date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), entryId, a.categoryId, a.amountCents, a.subcategoryId, a.merchantId, a.merchantLabel, a.platformId,
        a.tripFrom, a.tripTo, a.tripDate, a.note),
  );
}

/** Mémoire d'usage : les marchands déjà utilisés remontent en tête des suggestions. */
function merchantUsage(db: D1Database, userId: string, lines: ResolvedLine[]) {
  const ids = [...new Set(lines.map((l) => l.merchantId).filter((x): x is string => !!x))];
  const at = nowISO();
  return ids.map((id) =>
    db
      .prepare(
        `INSERT INTO merchant_prefs (user_id, merchant_id, use_count, last_used_at) VALUES (?, ?, 1, ?)
         ON CONFLICT (user_id, merchant_id) DO UPDATE SET use_count = use_count + 1, last_used_at = excluded.last_used_at`,
      )
      .bind(userId, id, at),
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
    const lines = await resolveLines(db, userId, input);
    const periodId = await getOrCreatePeriodId(db, userId, monthKeyFromDate(input.date));
    const loc = locationColumns(input);
    const id = uuid();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO expense_entries (id, user_id, period_id, spent_on, location_type, country_code, country_name, city,
               payment_method_id, payment_label, description, notes, channel, client_request_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, userId, periodId, input.date, loc.type, loc.code, loc.country, loc.city, payment.id, payment.label,
            input.description || null, input.notes || null, input.channel ?? null, input.clientRequestId ?? null),
        ...lineInserts(db, id, lines),
        ...merchantUsage(db, userId, lines),
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
    const lines = await resolveLines(db, userId, input);
    const periodId = await getOrCreatePeriodId(db, userId, monthKeyFromDate(input.date));
    const loc = locationColumns(input);
    await db.batch([
      db
        .prepare(
          `UPDATE expense_entries SET period_id = ?, spent_on = ?, location_type = ?, country_code = ?, country_name = ?, city = ?,
             payment_method_id = ?, payment_label = ?, description = ?, notes = ?, channel = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .bind(periodId, input.date, loc.type, loc.code, loc.country, loc.city, payment.id, payment.label,
          input.description || null, input.notes || null, input.channel ?? null, nowISO(), id, userId),
      db.prepare("DELETE FROM expense_amounts WHERE entry_id = ?").bind(id),
      ...lineInserts(db, id, lines),
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
