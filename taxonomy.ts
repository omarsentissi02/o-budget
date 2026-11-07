import type { CategoryId } from "./categories";

/**
 * Sous-catégories système (identifiants stables). Les sous-catégories personnalisées de l'utilisateur
 * sont stockées en base (table `subcategories`) et fusionnées côté API.
 *
 * `trip`     : la ligne propose départ / destination / date de voyage.
 * `merchant` : la ligne propose le choix d'un établissement (annuaire + marchands personnels).
 * `platform` : la ligne propose la plateforme / le canal d'achat (Uber Eats, Deliveroo, commande directe…).
 * `recurring`: un abonnement est probable → l'interface suggère de créer un abonnement plutôt qu'une dépense isolée.
 */
export interface SubcategoryDef {
  id: string;
  categoryId: CategoryId;
  label: string;
  merchant?: boolean;
  platform?: boolean;
  trip?: boolean;
  recurring?: boolean;
}

const s = (categoryId: CategoryId, id: string, label: string, flags: Partial<SubcategoryDef> = {}): SubcategoryDef => ({
  id,
  categoryId,
  label,
  ...flags,
});

export const SUBCATEGORIES: readonly SubcategoryDef[] = [
  // Alimentation
  s("alimentation", "supermarche", "Supermarché", { merchant: true }),
  s("alimentation", "courses", "Courses du quotidien", { merchant: true }),
  s("alimentation", "boulangerie", "Boulangerie", { merchant: true }),
  s("alimentation", "boucherie", "Boucherie", { merchant: true }),
  s("alimentation", "fruits_legumes", "Fruits et légumes", { merchant: true }),
  s("alimentation", "restaurant", "Restaurant", { merchant: true, platform: true }),
  s("alimentation", "snack", "Snack", { merchant: true, platform: true }),
  s("alimentation", "fast_food", "Fast-food", { merchant: true, platform: true }),
  s("alimentation", "livraison", "Livraison de repas", { merchant: true, platform: true }),
  s("alimentation", "autre_alimentation", "Autres achats alimentaires", { merchant: true }),
  // Transport
  s("transport", "train_tgv", "Train / TGV", { trip: true, merchant: true }),
  s("transport", "ter", "TER", { trip: true }),
  s("transport", "ouigo", "OUIGO", { trip: true }),
  s("transport", "avion", "Avion", { trip: true, merchant: true }),
  s("transport", "bus", "Bus / car", { trip: true, merchant: true }),
  s("transport", "metro_rer", "Métro / RER"),
  s("transport", "navigo", "Abonnement Navigo", { recurring: true }),
  s("transport", "covoiturage", "Covoiturage", { trip: true }),
  s("transport", "taxi_vtc", "Taxi / VTC", { merchant: true }),
  s("transport", "uber", "Uber"),
  s("transport", "bolt", "Bolt"),
  s("transport", "velo_location", "Location de vélo", { merchant: true }),
  s("transport", "velib", "Vélib'", { recurring: true }),
  s("transport", "moto_trottinette", "Location moto / scooter", { merchant: true }),
  s("transport", "yego", "Yego"),
  s("transport", "parking", "Parking"),
  s("transport", "carburant", "Carburant", { merchant: true }),
  // Shopping
  s("shopping", "vetements", "Vêtements", { merchant: true }),
  s("shopping", "chaussures", "Chaussures", { merchant: true }),
  s("shopping", "equipement_sport", "Équipement sportif", { merchant: true }),
  s("shopping", "electronique", "Électronique", { merchant: true }),
  s("shopping", "informatique", "Matériel informatique", { merchant: true }),
  s("shopping", "accessoires", "Accessoires", { merchant: true }),
  s("shopping", "maison_meubles", "Maison et meubles", { merchant: true }),
  s("shopping", "beaute", "Beauté", { merchant: true }),
  s("shopping", "gadgets", "Gadgets", { merchant: true }),
  s("shopping", "autres_achats", "Autres achats", { merchant: true }),
  // Santé
  s("sante", "medecin_generaliste", "Médecin généraliste"),
  s("sante", "specialiste", "Spécialiste"),
  s("sante", "pharmacie", "Pharmacie", { merchant: true }),
  s("sante", "dentiste", "Dentiste"),
  s("sante", "opticien", "Opticien", { merchant: true }),
  s("sante", "analyses", "Analyses médicales"),
  s("sante", "autre_sante", "Autres soins"),
  // Sport
  s("sport", "football", "Football"),
  s("sport", "padel", "Padel"),
  s("sport", "salle", "Salle de sport", { recurring: true }),
  s("sport", "natation", "Natation"),
  s("sport", "equipement", "Équipement sportif", { merchant: true }),
  // Loisirs
  s("loisirs", "divertissement", "Divertissement", { merchant: true }),
  s("loisirs", "autre_loisir", "Autres loisirs"),
  // Services & divers
  s("laverie", "laverie", "Laverie"),
  s("laverie", "pressing", "Pressing"),
  s("soins", "coiffeur_barbier", "Coiffeur / barbier"),
  s("soins", "hygiene", "Hygiène personnelle", { merchant: true }),
  s("telecom", "mobile", "Forfait mobile", { recurring: true }),
  s("telecom", "internet", "Internet / box", { recurring: true }),
  s("telecom", "autre_telecom", "Autres télécoms"),
  s("etudes", "scolarite", "Frais de scolarité"),
  s("etudes", "fournitures", "Fournitures et livres"),
  s("etudes", "formation", "Formation"),
  s("voyage", "hebergement", "Hébergement", { trip: true, merchant: true }),
  s("voyage", "activites_voyage", "Activités en voyage"),
  s("voyage", "autre_voyage", "Autres frais de voyage"),
  s("logement", "loyer", "Loyer"),
  s("logement", "charges", "Charges"),
  s("logement", "electricite", "Électricité", { recurring: true }),
  s("logement", "eau_gaz", "Eau / gaz"),
  s("logement", "entretien", "Entretien et réparations"),
  s("assurance", "assurance_habitation", "Assurance habitation", { recurring: true }),
  s("assurance", "mutuelle", "Mutuelle santé", { recurring: true }),
  s("assurance", "assurance_auto", "Assurance auto / moto", { recurring: true }),
  s("assurance", "autre_assurance", "Autre assurance"),
  s("administration", "impots", "Impôts et taxes"),
  s("administration", "amendes", "Amendes"),
  s("administration", "frais_dossier", "Frais de dossier et timbres"),
  s("cadeaux", "cadeau", "Cadeau"),
  s("exceptionnel", "exceptionnel", "Dépense exceptionnelle"),
  // Abonnements (familles de la fonctionnalité Abonnements)
  s("abonnements", "abo_pro", "Pro & freelance", { recurring: true }),
  s("abonnements", "abo_perso", "Personnel & loisirs", { recurring: true }),
  s("abonnements", "abo_transport", "Transport", { recurring: true }),
];

const subById = new Map(SUBCATEGORIES.map((x) => [x.id, x]));

export function getSubcategory(id: string | null | undefined): SubcategoryDef | undefined {
  return id ? subById.get(id) : undefined;
}

export function subcategoriesOf(categoryId: string): SubcategoryDef[] {
  return SUBCATEGORIES.filter((x) => x.categoryId === categoryId);
}

export function isSystemSubcategory(categoryId: string, subId: string): boolean {
  return subById.get(subId)?.categoryId === categoryId;
}

// --- Plateformes et canaux d'achat -------------------------------------------------------------

export interface PlatformDef {
  id: string;
  label: string;
  kind: "delivery" | "direct";
}

/**
 * Plateformes : DISTINCTES de la catégorie. Exemple : Alimentation → Fast-food → O'Tacos → Uber Eats.
 * Liste volontairement maintenue à la main (aucune extraction automatique de plateformes commerciales).
 */
export const PLATFORMS: readonly PlatformDef[] = [
  { id: "ubereats", label: "Uber Eats", kind: "delivery" },
  { id: "deliveroo", label: "Deliveroo", kind: "delivery" },
  { id: "direct", label: "Commande directe au restaurant", kind: "direct" },
  { id: "other_delivery", label: "Autre plateforme de livraison", kind: "delivery" },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id) as [string, ...string[]];
const platformById = new Map(PLATFORMS.map((p) => [p.id, p]));
export const getPlatform = (id: string | null | undefined) => (id ? platformById.get(id) : undefined);

export const CHANNELS = [
  { id: "in_store", label: "Sur place" },
  { id: "takeaway", label: "À emporter" },
  { id: "delivery", label: "Livraison" },
  { id: "online", label: "En ligne" },
  { id: "app", label: "Application" },
] as const;
export type ChannelId = (typeof CHANNELS)[number]["id"];
export const CHANNEL_IDS = CHANNELS.map((c) => c.id) as [ChannelId, ...ChannelId[]];

/** Clé de regroupement analytique pour une plateforme absente. */
export const NO_PLATFORM = "none";
