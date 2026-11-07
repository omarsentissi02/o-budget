import type { CategoryId } from "./categories";

/**
 * Annuaire SYSTÈME de marchands (identifiants stables `m_*`), maintenu à la main.
 * Aucune donnée n'est récupérée automatiquement auprès de sites commerciaux.
 *
 * Statut halal : attribut SÉPARÉ et vérifiable. Aucun établissement n'est considéré halal d'après son nom :
 * tout marchand système démarre en « unknown ». L'utilisateur peut le passer en « claimed » (déclaré par
 * l'établissement) ou « verified » (vérifié, avec la source obligatoire : certificat, site officiel, note…).
 *
 * McDonald's, KFC et Burger King ne sont volontairement pas suggérés (ils restent saisissables à la main).
 */
export type HalalStatus = "unknown" | "claimed" | "verified";

export interface SystemMerchant {
  id: string;
  label: string;
  categoryId: CategoryId;
  /** Sous-catégories pour lesquelles ce marchand est suggéré en priorité. */
  subcategoryIds: string[];
  /** Les types de lieux qui peuvent être halal (restauration) portent un statut ; sinon null. */
  halalStatus: HalalStatus | null;
}

const food = (id: string, label: string, subs: string[], halal: HalalStatus | null = null): SystemMerchant => ({
  id: `m_${id}`,
  label,
  categoryId: "alimentation",
  subcategoryIds: subs,
  halalStatus: halal,
});
const shop = (id: string, label: string, subs: string[], category: CategoryId = "shopping"): SystemMerchant => ({
  id: `m_${id}`,
  label,
  categoryId: category,
  subcategoryIds: subs,
  halalStatus: null,
});

export const SYSTEM_MERCHANTS: readonly SystemMerchant[] = [
  // Supermarchés
  food("auchan", "Auchan", ["supermarche", "courses"]),
  food("carrefour", "Carrefour", ["supermarche", "courses"]),
  food("franprix", "Franprix", ["supermarche", "courses"]),
  food("monoprix", "Monoprix", ["supermarche", "courses"]),
  food("lidl", "Lidl", ["supermarche", "courses"]),
  food("aldi", "Aldi", ["supermarche", "courses"]),
  food("leclerc", "E.Leclerc", ["supermarche", "courses"]),
  food("intermarche", "Intermarché", ["supermarche", "courses"]),
  food("superu", "Super U", ["supermarche", "courses"]),
  food("casino", "Casino", ["supermarche", "courses"]),
  // Restauration rapide à orientation halal : statut à vérifier par l'utilisateur
  food("otacos", "O'Tacos", ["fast_food", "livraison"], "unknown"),
  food("chamas", "Chamas Tacos", ["fast_food", "livraison"], "unknown"),
  // Shopping
  shop("zara", "Zara", ["vetements", "chaussures", "accessoires"]),
  shop("hm", "H&M", ["vetements", "chaussures", "accessoires", "maison_meubles"]),
  shop("primark", "Primark", ["vetements", "chaussures", "accessoires"]),
  shop("decathlon", "Decathlon", ["equipement_sport", "vetements", "chaussures"]),
  shop("intersport", "Intersport", ["equipement_sport", "vetements", "chaussures"]),
  shop("fnac", "Fnac", ["electronique", "informatique", "gadgets"]),
  shop("darty", "Darty", ["electronique", "informatique"]),
  shop("boulanger", "Boulanger", ["electronique", "informatique"]),
  shop("ikea", "IKEA", ["maison_meubles"]),
  shop("action", "Action", ["maison_meubles", "gadgets", "autres_achats"]),
  shop("sephora", "Sephora", ["beaute"]),
  shop("apple", "Apple", ["electronique", "informatique", "accessoires"]),
  // Transport
  shop("sncf", "SNCF Connect", ["train_tgv", "ter"], "transport"),
  shop("ouigo", "OUIGO", ["ouigo"], "transport"),
  shop("blablacar", "BlaBlaCar", ["covoiturage"], "transport"),
  shop("idfm", "Île-de-France Mobilités", ["navigo", "metro_rer"], "transport"),
  shop("ratp", "RATP", ["metro_rer", "bus"], "transport"),
  shop("flixbus", "FlixBus", ["bus"], "transport"),
];

const byId = new Map(SYSTEM_MERCHANTS.map((m) => [m.id, m]));
export const getSystemMerchant = (id: string) => byId.get(id);
export const isSystemMerchantId = (id: string) => byId.has(id);

/** Normalisation pour la recherche et la détection de doublons : minuscules, sans accents ni ponctuation. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface MerchantView {
  id: string;
  label: string;
  system: boolean;
  categoryId: CategoryId | null;
  subcategoryIds: string[];
  halalStatus: HalalStatus | null;
  halalSource: string | null;
  halalVerifiedAt: string | null;
  useCount: number;
  lastUsedAt: string | null;
}

/**
 * Tri de suggestion : marchands les plus utilisés d'abord, puis ceux liés à la sous-catégorie, puis alphabétique.
 * `query` filtre sur le libellé normalisé (préfixe de mot ou sous-chaîne).
 */
export function rankMerchants(
  merchants: MerchantView[],
  opts: { categoryId?: string; subcategoryId?: string | null; query?: string },
): MerchantView[] {
  const q = normalizeText(opts.query ?? "");
  return merchants
    .filter((m) => (q ? normalizeText(m.label).includes(q) : true))
    .map((m) => ({
      m,
      score:
        (m.useCount > 0 ? 1000 + Math.min(m.useCount, 500) : 0) +
        (opts.subcategoryId && m.subcategoryIds.includes(opts.subcategoryId) ? 100 : 0) +
        (opts.categoryId && m.categoryId === opts.categoryId ? 10 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.m.label.localeCompare(b.m.label, "fr"))
    .map((x) => x.m);
}
