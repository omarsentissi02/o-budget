import app from "../../worker/index";
import { newDb, asD1, type FakeD1 } from "./d1";

export const ORIGIN = "http://localhost";

export interface Res<T = any> {
  status: number;
  data: T;
  text: string;
  bytes: Uint8Array;
  headers: Headers;
}

/** Client HTTP en mémoire : appelle la VRAIE application Hono, avec un cookie de session par client. */
export function makeClient(db: FakeD1, env: Record<string, string> = {}) {
  let cookie = "";
  const call = async <T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> => {
    const req = new Request(`${ORIGIN}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: ORIGIN,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = await app.fetch(req, { DB: asD1(db), ...env });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* texte (CSV) */
    }
    return { status: res.status, data: data as T, text, bytes, headers: res.headers };
  };
  return call;
}

let counter = 0;
/** Crée un utilisateur connecté. */
export async function signup(db: FakeD1, name = "Omar", env: Record<string, string> = {}) {
  const call = makeClient(db, env);
  const email = `${name.toLowerCase()}${++counter}@example.com`;
  const r = await call("POST", "/auth/register", { name, email, password: "motdepasse-solide" });
  if (r.status !== 201) throw new Error("signup failed: " + r.text);
  const methods = r.data.paymentMethods as { id: string; name: string }[];
  return { call, email, userId: r.data.user.id as string, lcl: methods.find((m) => m.name === "LCL")!.id, methods };
}

export const freshDb = () => newDb();

export function addMonths(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
