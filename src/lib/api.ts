export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const GENERIC = "Une erreur est survenue. Réessayez.";

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = options;
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    console.error("[api] réseau", path, e);
    throw new ApiRequestError(0, "Connexion impossible. Vérifiez votre réseau puis réessayez.");
  }
  if (!res.ok) {
    let message = GENERIC;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* réponse non JSON : on garde le message générique */
    }
    if (res.status >= 500) console.error("[api]", res.status, path);
    throw new ApiRequestError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : GENERIC;
}

/** Télécharge un export CSV (fonctionne aussi en mode application installée). */
export async function download(path: string, filename: string) {
  const res = await fetch("/api" + path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiRequestError(res.status, "L'export a échoué. Réessayez.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
