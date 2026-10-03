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
  { id: "autre", label: "Autre", emoji: "📦", color: "#7C8494" },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryId = Category["id"];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

const byId = new Map<string, Category>(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category {
  return byId.get(id) ?? CATEGORIES[CATEGORIES.length - 1];
}

export function categoryOrder(id: string): number {
  return CATEGORY_IDS.indexOf(id as CategoryId);
}
