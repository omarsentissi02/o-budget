import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { getCategory } from "../../shared/categories";
import { centsToPlain } from "../../shared/money";
import { dayFR } from "../../shared/month";

type Format = "csv" | "excel";

function toCsv(rows: (string | number)[][], format: Format): string {
  const sep = format === "excel" ? ";" : ",";
  const esc = (v: string | number) => {
    const s = String(v);
    const needsQuotes = s.includes(sep) || /["\n\r]/.test(s);
    return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(sep)).join("\r\n");
  // Le BOM UTF-8 permet à Excel d'afficher correctement les accents.
  return (format === "excel" ? "\uFEFF" : "") + body + "\r\n";
}

const SOURCE_LABEL: Record<string, string> = { alternance: "Alternance", freelance: "Freelance", other: "Autre revenu" };

export const exportRoutes = new Hono<AppEnv>().get("/export", async (c) => {
  const userId = c.get("userId");
  const type = c.req.query("type");
  const format = (c.req.query("format") === "excel" ? "excel" : "csv") as Format;
  const dec = format === "excel" ? "," : ".";
  const date = (iso: string | null) => (iso ? (format === "excel" ? dayFR(iso) : iso) : "");
  let rows: (string | number)[][];

  if (type === "expenses") {
    const { results } = await c.env.DB.prepare(
      `SELECT e.spent_on, e.city, e.country_name, a.category_id, a.amount_cents, e.payment_label, e.description
       FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
       WHERE e.user_id = ? ORDER BY e.spent_on, e.created_at`,
    )
      .bind(userId)
      .all<{ spent_on: string; city: string | null; country_name: string; category_id: string; amount_cents: number; payment_label: string; description: string | null }>();
    rows = [
      ["Date", "Lieu", "Pays", "Catégorie", "Montant (EUR)", "Moyen de paiement", "Description"],
      ...results.map((r) => [
        date(r.spent_on), r.city ?? "", r.country_name, getCategory(r.category_id).label,
        centsToPlain(r.amount_cents, dec), r.payment_label, r.description ?? "",
      ]),
    ];
  } else if (type === "incomes") {
    const [inc, sav] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT p.month, i.source, i.label, i.amount_cents, i.received_on FROM incomes i
         JOIN financial_periods p ON p.id = i.period_id WHERE i.user_id = ? ORDER BY p.month, i.created_at`,
      ).bind(userId),
      c.env.DB.prepare(
        `SELECT p.month, s.amount_cents FROM savings s JOIN financial_periods p ON p.id = s.period_id
         WHERE s.user_id = ? ORDER BY p.month`,
      ).bind(userId),
    ]);
    rows = [
      ["Mois", "Type", "Libellé", "Montant (EUR)", "Date"],
      ...(inc.results as { month: string; source: string; label: string; amount_cents: number; received_on: string | null }[]).map((r) => [
        r.month, SOURCE_LABEL[r.source] ?? r.source, r.label, centsToPlain(r.amount_cents, dec), date(r.received_on),
      ]),
      ...(sav.results as { month: string; amount_cents: number }[]).map((r) => [
        r.month, "Épargne", "Épargne du mois", centsToPlain(r.amount_cents, dec), "",
      ]),
    ];
  } else {
    throw new ApiError(400, "Type d'export inconnu.");
  }

  const filename = `o-budget-${type === "expenses" ? "depenses" : "revenus-epargne"}${format === "excel" ? "-excel" : ""}.csv`;
  return c.body(toCsv(rows, format), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
});
