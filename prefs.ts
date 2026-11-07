import type { LocationDTO } from "../../shared/types";

/** Derniers choix de saisie, pour pré-remplir la prochaine dépense (gain de temps). */
interface LastChoices {
  location?: LocationDTO;
  paymentMethodId?: string | null;
}

const KEY = "ob:last";

export function readLast(): LastChoices {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as LastChoices;
  } catch {
    return {};
  }
}

export function writeLast(value: LastChoices) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* ignoré */
  }
}

export function clearLocalData() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignoré */
  }
  if ("caches" in window) caches.keys().then((ks) => ks.filter((k) => k === "ob-api").forEach((k) => caches.delete(k))).catch(() => undefined);
  try {
    navigator.serviceWorker?.controller?.postMessage("purge");
  } catch {
    /* ignoré */
  }
}
