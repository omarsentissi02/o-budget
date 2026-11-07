import { getOrCreatePeriodId } from "./periods";
import { uuid } from "./http";

/** Statements d'écriture d'UNE dépense à une ligne (utilisé quand une échéance ou un abonnement est marqué payé). */
export async function singleLineExpense(
  db: D1Database,
  userId: string,
  e: {
    date: string;
    categoryId: string;
    subcategoryId: string | null;
    amountCents: number;
    paymentMethodId: string | null;
    paymentLabel: string;
    description: string;
  },
) {
  const periodId = await getOrCreatePeriodId(db, userId, e.date.slice(0, 7));
  const entryId = uuid();
  return [
    db
      .prepare(
        `INSERT INTO expense_entries (id, user_id, period_id, spent_on, location_type, country_code, country_name, city,
           payment_method_id, payment_label, description) VALUES (?, ?, ?, ?, 'france', 'FR', 'France', NULL, ?, ?, ?)`,
      )
      .bind(entryId, userId, periodId, e.date, e.paymentMethodId, e.paymentLabel, e.description),
    db
      .prepare("INSERT INTO expense_amounts (id, entry_id, category_id, amount_cents, subcategory_id) VALUES (?, ?, ?, ?, ?)")
      .bind(uuid(), entryId, e.categoryId, e.amountCents, e.subcategoryId),
  ];
}

export async function paymentLabelFor(db: D1Database, userId: string, paymentMethodId: string | null | undefined) {
  if (!paymentMethodId) return { id: null as string | null, label: "Autre" };
  const row = await db.prepare("SELECT name FROM payment_methods WHERE id = ? AND user_id = ?").bind(paymentMethodId, userId).first<{ name: string }>();
  return row ? { id: paymentMethodId, label: row.name } : null;
}
