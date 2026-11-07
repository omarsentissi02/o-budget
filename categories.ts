/**
 * Catégories principales (identifiants STABLES, jamais renommés : ils sont stockés en base).
 * Les 10 premières sont celles de la V1 ; les suivantes sont ajoutées par la migration 0003.
 * `legacy` : catégorie conservée pour l'historique V1, non proposée pour une nouvelle dépense.
 */
export const CATEGORIES = [
  { id: "logement", label: "Logement", emoji: "🏠", color: "#4F5BD5" },
  { id: "alimentation", label: "Alimentation", emoji: "🍔", color: "#E0922F" },
  { id: "transport", label: "Transport", emoji: "🚆", color: "#2B8FC6" },
  { id: "sport", label: "Sport", emoji: "🏋️", color: "#2E9E6E" },
  { id: "loisirs", label: "Loisirs", emoji: "🎮", color: "#8A5CD1" },
  { id: "abonnements", label: "Abonnements", emoji: "📱", color: "#D3557E" },
  { id: "etudes", label: "Études", emoji: "🎓", color: "#3F8F94" },
  { id: "shopping", label: "Shopping", emoji: "🛍", color: "#C46A3E" },
  { id: "sante", label: "Santé", emoji: "💊", color: "#CC4B4B" },
  { id: "autre", label: "Autre (ancien)", emoji: "📦", color: "#7C8494", legacy: true },
  // --- V2 ---
  { id: "laverie", label: "Laverie & pressing", emoji: "🧺", color: "#5B9BD5" },
  { id: "soins", label: "Coiffure & hygiène", emoji: "💈", color: "#B5651D" },
  { id: "telecom", label: "Télécommunications", emoji: "📶", color: "#6C7BDB" },
  { id: "voyage", label: "Voyages & hébergement", emoji: "✈️", color: "#1F9FB3" },
  { id: "assurance", label: "Assurances", emoji: "🛡️", color: "#7A8B3C" },
  { id: "administration", label: "Administration", emoji: "🗂️", color: "#8C6D5A" },
  { id: "cadeaux", label: "Cadeaux", emoji: "🎁", color: "#D9627A" },
  { id: "exceptionnel", label: "Dépenses exceptionnelles", emoji: "⚡", color: "#A0527C" },
] as const;

export type Category = (typeof CATEGORIES)[number] & { legacy?: boolean };
export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

/** Catégories proposées pour une nouvelle saisie (hors « ancien »). */
export const SELECTABLE_CATEGORIES: readonly Category[] = CATEGORIES.filter((c) => !("legacy" in c && c.legacy));

const byId = new Map<string, Category>(CATEGORIES.map((c) => [c.id, c]));

export function isCategoryId(id: string): id is CategoryId {
  return byId.has(id);
}

export function getCategory(id: string): Category {
  return byId.get(id) ?? (byId.get("autre") as Category);
}

export function categoryOrder(id: string): number {
  return CATEGORY_IDS.indexOf(id as CategoryId);
}
