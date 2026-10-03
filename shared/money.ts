/** Tous les montants circulent en centimes (entiers). */

const SEPARATORS = /[\s\u00a0\u202f€]/g;
export const MAX_AMOUNT_CENTS = 100_000_000; // 1 000 000,00 €

/** "12,5" → 1250 ; "1 202,00 €" → 120200 ; texte invalide, vide ou négatif → null. */
export function parseAmountToCents(input: string): number | null {
  const s = input.replace(SEPARATORS, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [intPart, decPart = ""] = s.split(".");
  const cents = Number(intPart) * 100 + Number((decPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurRound = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** 120200 → "1 202,00 €" */
export function formatEUR(cents: number): string {
  return eur.format(cents / 100);
}

/** 120200 → "1 202 €" (graphiques, calendrier) */
export function formatEURRounded(cents: number): string {
  return eurRound.format(Math.round(cents / 100));
}

/** 1250 → "12,50" (pré-remplissage d'un champ) */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** CSV : nombre sans symbole, décimale au choix. */
export function centsToPlain(cents: number, decimal: "." | ","): string {
  return (cents / 100).toFixed(2).replace(".", decimal);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value) + " %";
}
