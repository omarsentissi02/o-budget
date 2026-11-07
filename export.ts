import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { getCategory } from "../../shared/categories";
import { getSubcategory, getPlatform } from "../../shared/taxonomy";
import { incomeKindLabel, incomeStatusLabel, frequencyLabel } from "../../shared/income";
import { familyLabel } from "../../shared/subscriptions";
import { priorityLabel } from "../../shared/tasks";
import { centsToPlain } from "../../shared/money";
import { dayFR } from "../../shared/month";

type Format = "csv" | "excel";
type Cell = string | number;

/**
 * Neutralise l'injection de formules (CSV injection) : une cellule TEXTE qui commence par = + - @ tabulation ou
 * retour chariot est préfixée d'une apostrophe. Les nombres (montants) ne sont jamais modifiés.
 */
export function safeCell(v: Cell): string {
  if (typeof v === "number") return String(v);
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) return `'${v}`;
  return v;
}

export function toCsv(rows: Cell[][], format: Format): string {
  const sep = format === "excel" ? ";" : ",";
  const esc = (raw: Cell) => {
    const s = safeCell(raw);
    const needsQuotes = s.includes(sep) || /["\n\r]/.test(s);
    return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(sep)).join("\r\n");
  // Le BOM UTF-8 permet à Excel d'afficher correctement les accents.
  return (format === "excel" ? "﻿" : "") + body + "\r\n";
}

const SOURCE_LABEL: Record<string, string> = { alternance: "Alternance", freelance: "Freelance", other: "Autre revenu" };
const FILENAMES: Record<string, string> = {
  expenses: "depenses", incomes: "revenus-epargne", subscriptions: "abonnements", tasks: "taches",
};

export const exportRoutes = new Hono<AppEnv>().get("/export", async (c) => {
  const userId = c.get("userId");
  const type = c.req.query("type") ?? "";
  const format = (c.req.query("format") === "excel" ? "excel" : "csv") as Format;
  const dec = format === "excel" ? "," : ".";
  const date = (iso: string | null) => (iso ? (format === "excel" ? dayFR(iso) : iso) : "");
  const db = c.env.DB;
  let rows: Cell[][];

  if (type === "expenses") {
    // Colonnes V1 conservées à l'identique, colonnes V2 ajoutées à la fin.
    const { results } = await db
      .prepare(
        `SELECT e.spent_on, e.city, e.country_name, a.category_id, a.amount_cents, e.payment_label, e.description,
           a.subcategory_id, s.label AS sub_label, a.merchant_label, a.platform_id, e.channel, a.trip_from, a.trip_to, a.trip_date, COALESCE(a.note, e.notes) AS note
         FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id LEFT JOIN subcategories s ON s.id = a.subcategory_id
         WHERE e.user_id = ? ORDER BY e.spent_on, e.created_at`,
      )
      .bind(userId)
      .all<Record<string, string | number | null>>();
    rows = [
      ["Date", "Lieu", "Pays", "Catégorie", "Montant (EUR)", "Moyen de paiement", "Description", "Sous-catégorie", "Établissement", "Plateforme", "Canal", "Départ", "Destination", "Date du voyage", "Notes"],
      ...results.map((r) => [
        date(r.spent_on as string), (r.city as string) ?? "", r.country_name as string, getCategory(r.category_id as string).label,
        centsToPlain(r.amount_cents as number, dec), r.payment_label as string, (r.description as string) ?? "",
        getSubcategory(r.subcategory_id as string)?.label ?? (r.sub_label as string) ?? "", (r.merchant_label as string) ?? "",
        getPlatform(r.platform_id as string)?.label ?? "", (r.channel as string) ?? "", (r.trip_from as string) ?? "", (r.trip_to as string) ?? "",
        date(r.trip_date as string | null), (r.note as string) ?? "",
      ]),
    ];
  } else if (type === "incomes") {
    const [inc, sav] = await db.batch([
      db.prepare(
        `SELECT p.month, i.source, i.label, i.amount_cents, i.received_on, d.kind, COALESCE(d.status, 'confirmed') AS status, COALESCE(d.frequency, 'once') AS frequency,
           d.gross_cents, d.organization, COALESCE(d.paid_to, 'user') AS paid_to, d.third_party_name
         FROM incomes i JOIN financial_periods p ON p.id = i.period_id LEFT JOIN income_details d ON d.income_id = i.id
         WHERE i.user_id = ? ORDER BY p.month, i.created_at`,
      ).bind(userId),
      db.prepare(`SELECT p.month, s.amount_cents FROM savings s JOIN financial_periods p ON p.id = s.period_id WHERE s.user_id = ? ORDER BY p.month`).bind(userId),
    ]);
    rows = [
      ["Mois", "Type", "Libellé", "Montant (EUR)", "Date", "Nature", "Statut", "Fréquence", "Brut (EUR)", "Organisme", "Versé à"],
      ...(inc.results as Record<string, string | number | null>[]).map((r) => [
        r.month as string, SOURCE_LABEL[r.source as string] ?? (r.source as string), r.label as string, centsToPlain(r.amount_cents as number, dec), date(r.received_on as string | null),
        incomeKindLabel((r.kind as string) ?? (r.source as string)), incomeStatusLabel(r.status as string), frequencyLabel(r.frequency as string),
        r.gross_cents === null ? "" : centsToPlain(r.gross_cents as number, dec), (r.organization as string) ?? "",
        r.paid_to === "third_party" ? ((r.third_party_name as string) || "Tiers") : "Moi",
      ]),
      ...(sav.results as { month: string; amount_cents: number }[]).map((r) => [
        r.month, "Épargne", "Épargne du mois", centsToPlain(r.amount_cents, dec), "", "Épargne", "", "", "", "", "",
      ]),
    ];
  } else if (type === "subscriptions") {
    const { results } = await db
      .prepare("SELECT name, family, amount_cents, frequency, start_date, renewal_date, payment_label, status, cancel_notes FROM subscriptions WHERE user_id = ? ORDER BY name")
      .bind(userId).all<Record<string, string | number | null>>();
    rows = [
      ["Nom", "Famille", "Montant (EUR)", "Fréquence", "Début", "Prochain renouvellement", "Moyen de paiement", "Statut", "Résiliation"],
      ...results.map((r) => [
        r.name as string, familyLabel(r.family as string), centsToPlain(r.amount_cents as number, dec), frequencyLabel(r.frequency as string),
        date(r.start_date as string | null), date(r.renewal_date as string | null), r.payment_label as string, r.status as string, (r.cancel_notes as string) ?? "",
      ]),
    ];
  } else if (type === "tasks") {
    const { results } = await db
      .prepare("SELECT title, description, priority, status, due_date, due_time, estimated_minutes, created_at, completed_at FROM tasks WHERE user_id = ? ORDER BY due_date IS NULL, due_date, due_time")
      .bind(userId).all<Record<string, string | number | null>>();
    rows = [
      ["Titre", "Description", "Priorité", "Statut", "Échéance", "Heure", "Durée estimée (min)", "Créée le", "Terminée le"],
      ...results.map((r) => [
        r.title as string, (r.description as string) ?? "", priorityLabel(r.priority as string), r.status as string, date(r.due_date as string | null),
        (r.due_time as string) ?? "", (r.estimated_minutes as number) ?? "", (r.created_at as string).slice(0, 10), ((r.completed_at as string) ?? "").slice(0, 10),
      ]),
    ];
  } else {
    throw new ApiError(400, "Type d'export inconnu.");
  }

  const filename = `o-budget-${FILENAMES[type]}${format === "excel" ? "-excel" : ""}.csv`;
  return c.body(toCsv(rows, format), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
});
