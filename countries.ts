export interface Country {
  code: string;
  name: string;
}

/** Pays proposés pour une dépense à l'étranger (le choix « Autre » permet une saisie libre). */
export const COUNTRIES: Country[] = [
  { code: "MA", name: "Maroc" },
  { code: "ES", name: "Espagne" },
  { code: "IT", name: "Italie" },
  { code: "PT", name: "Portugal" },
  { code: "BE", name: "Belgique" },
  { code: "CH", name: "Suisse" },
  { code: "DE", name: "Allemagne" },
  { code: "GB", name: "Royaume-Uni" },
  { code: "NL", name: "Pays-Bas" },
  { code: "LU", name: "Luxembourg" },
  { code: "IE", name: "Irlande" },
  { code: "AT", name: "Autriche" },
  { code: "GR", name: "Grèce" },
  { code: "TR", name: "Turquie" },
  { code: "TN", name: "Tunisie" },
  { code: "DZ", name: "Algérie" },
  { code: "SN", name: "Sénégal" },
  { code: "EG", name: "Égypte" },
  { code: "AE", name: "Émirats arabes unis" },
  { code: "US", name: "États-Unis" },
  { code: "CA", name: "Canada" },
  { code: "JP", name: "Japon" },
  { code: "TH", name: "Thaïlande" },
];

export const FRENCH_CITIES = ["Paris", "Montpellier"] as const;

/** "MA" → "🇲🇦" */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "🌍";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
