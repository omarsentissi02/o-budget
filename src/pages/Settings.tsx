import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, LogOut, Pencil, Plus, RotateCcw, Sun, Moon, Monitor } from "lucide-react";
import { CATEGORIES } from "../../shared/categories";
import { centsToInput, formatEUR, parseAmountToCents } from "../../shared/money";
import type { MeDTO, PaymentMethodDTO, Theme } from "../../shared/types";
import { api, download, errorMessage } from "../lib/api";
import { qk, useSession } from "../lib/queries";
import { applyTheme } from "../lib/theme";
import { clearLocalData } from "../lib/prefs";
import { useToast } from "../hooks/Toast";
import { Sheet, ConfirmSheet } from "../components/Sheet";
import { AmountInput, Button, Field, Panel, SectionTitle, Segmented, TextInput, useFieldId } from "../components/ui";

function Section({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  const id = useFieldId("section");
  return (
    <Panel aria-labelledby={id}>
      <SectionTitle id={id}>{title}</SectionTitle>
      {description && <p className="-mt-2 mb-4 text-sm text-muted">{description}</p>}
      {children}
    </Panel>
  );
}

function useMeMutation<TBody>(path: string, method: string, success: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: TBody) => api<MeDTO>(path, { method, body }),
    onSuccess: (me) => {
      qc.setQueryData(qk.me, me);
      toast(success);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

function ProfileForm() {
  const { user } = useSession();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const save = useMeMutation<{ name: string; email: string }>("/auth/profile", "PATCH", "Profil enregistré");
  const nameId = useFieldId("name");
  const emailId = useFieldId("email");
  const dirty = name !== user.name || email !== user.email;
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ name, email }); }}>
      <Field label="Prénom" htmlFor={nameId}>
        <TextInput id={nameId} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={60} />
      </Field>
      <Field label="E-mail" htmlFor={emailId}>
        <TextInput id={emailId} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      {dirty && <Button type="submit" loading={save.isPending}>Enregistrer le profil</Button>}
    </form>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const curId = useFieldId("cur");
  const newId = useFieldId("new");
  const save = useMutation({
    mutationFn: () => api<void>("/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      toast("Mot de passe modifié");
      setCurrent("");
      setNext("");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onClose={onClose} title="Changer de mot de passe" description="Vos autres appareils seront déconnectés.">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <Field label="Mot de passe actuel" htmlFor={curId}>
          <TextInput id={curId} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-autofocus />
        </Field>
        <Field label="Nouveau mot de passe" htmlFor={newId} error={error} hint="8 caractères minimum.">
          <TextInput id={newId} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} />
        </Field>
        <Button type="submit" size="lg" block loading={save.isPending} disabled={!current || next.length < 8}>
          Changer le mot de passe
        </Button>
      </form>
    </Sheet>
  );
}

function IncomeDefaults() {
  const { settings } = useSession();
  const [alt, setAlt] = useState(centsToInput(settings.defaultAlternanceCents));
  const [free, setFree] = useState(centsToInput(settings.defaultFreelanceCents));
  const [error, setError] = useState<string | null>(null);
  const save = useMeMutation<{ defaultAlternanceCents: number; defaultFreelanceCents: number }>("/settings", "PATCH", "Montants habituels enregistrés");
  const altId = useFieldId("alt");
  const freeId = useFieldId("free");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = parseAmountToCents(alt);
    const f = parseAmountToCents(free);
    if (a === null || f === null) return setError("Indiquez des montants valides, par exemple 1202 ou 500,00.");
    setError(null);
    save.mutate({ defaultAlternanceCents: a, defaultFreelanceCents: f });
  };
  const dirty = parseAmountToCents(alt) !== settings.defaultAlternanceCents || parseAmountToCents(free) !== settings.defaultFreelanceCents;
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field label="Alternance, par mois" htmlFor={altId}>
        <AmountInput id={altId} value={alt} onChange={setAlt} />
      </Field>
      <Field label="Freelance, par mois" htmlFor={freeId} error={error}>
        <AmountInput id={freeId} value={free} onChange={setFree} />
      </Field>
      {dirty && <Button type="submit" loading={save.isPending}>Enregistrer les montants</Button>}
    </form>
  );
}

function PaymentMethods() {
  const { paymentMethods } = useSession();
  const [editing, setEditing] = useState<PaymentMethodDTO | "new" | null>(null);
  const [name, setName] = useState("");
  const create = useMeMutation<{ name: string }>("/payment-methods", "POST", "Moyen de paiement ajouté");
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; archived?: boolean } }) =>
      api<MeDTO>(`/payment-methods/${id}`, { method: "PATCH", body }),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const inputId = useFieldId("pm");
  const open = (m: PaymentMethodDTO | "new") => {
    setName(m === "new" ? "" : m.name);
    setEditing(m);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !editing) return;
    if (editing === "new") await create.mutateAsync({ name: name.trim() }).catch(() => undefined);
    else await update.mutateAsync({ id: editing.id, body: { name: name.trim() } }).then(() => toast("Moyen de paiement renommé")).catch(() => undefined);
    setEditing(null);
  };

  return (
    <>
      <ul className="flex flex-col">
        {paymentMethods.map((m) => (
          <li key={m.id} className="flex min-h-13 items-center justify-between gap-2 py-1">
            <span className={`text-[15px] ${m.archived ? "text-faint line-through" : "font-medium"}`}>{m.name}</span>
            <span className="flex gap-1">
              {!m.archived && (
                <button type="button" onClick={() => open(m)} aria-label={`Renommer ${m.name}`} className="grid size-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink">
                  <Pencil size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={() => update.mutate({ id: m.id, body: { archived: !m.archived } })}
                aria-label={m.archived ? `Réactiver ${m.name}` : `Masquer ${m.name}`}
                className="grid size-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"
              >
                {m.archived ? <RotateCcw size={17} /> : <Archive size={17} />}
              </button>
            </span>
          </li>
        ))}
        <li className="flex min-h-13 items-center text-[15px] text-faint">Autre (toujours disponible)</li>
      </ul>
      <Button variant="secondary" className="mt-3" onClick={() => open("new")}>
        <Plus size={18} aria-hidden /> Ajouter un moyen de paiement
      </Button>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nouveau moyen de paiement" : "Renommer"}>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Nom" htmlFor={inputId}>
            <TextInput id={inputId} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ex. Boursorama" data-autofocus />
          </Field>
          <Button type="submit" size="lg" block loading={create.isPending || update.isPending} disabled={!name.trim()}>
            Enregistrer
          </Button>
        </form>
      </Sheet>
    </>
  );
}

function ThemePicker() {
  const { settings } = useSession();
  const save = useMeMutation<{ theme: Theme }>("/settings", "PATCH", "Thème enregistré");
  return (
    <Segmented
      label="Thème"
      value={settings.theme}
      onChange={(theme) => {
        applyTheme(theme);
        save.mutate({ theme });
      }}
      options={[
        { value: "light", label: <><Sun size={16} aria-hidden /> Clair</> },
        { value: "dark", label: <><Moon size={16} aria-hidden /> Sombre</> },
        { value: "system", label: <><Monitor size={16} aria-hidden /> Système</> },
      ]}
    />
  );
}

function DataManagement() {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const confirmId = useFieldId("confirm");

  const run = async (type: "expenses" | "incomes", format: "csv" | "excel") => {
    const key = type + format;
    setBusy(key);
    try {
      const name = `o-budget-${type === "expenses" ? "depenses" : "revenus-epargne"}${format === "excel" ? "-excel" : ""}.csv`;
      await download(`/export?type=${type}&format=${format}`, name);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const wipe = useMutation({
    mutationFn: () => api<void>("/data", { method: "DELETE", body: { confirm: typed } }),
    onSuccess: async () => {
      clearLocalData();
      setConfirmOpen(false);
      setTyped("");
      await qc.invalidateQueries();
      toast("Toutes vos données financières ont été supprimées");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Le format Excel utilise le point-virgule et la virgule décimale : il s'ouvre directement dans Excel en français.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={busy === "expensesexcel"} onClick={() => run("expenses", "excel")}><Download size={17} aria-hidden /> Dépenses (Excel)</Button>
        <Button variant="secondary" loading={busy === "expensescsv"} onClick={() => run("expenses", "csv")}><Download size={17} aria-hidden /> Dépenses (CSV)</Button>
        <Button variant="secondary" loading={busy === "incomesexcel"} onClick={() => run("incomes", "excel")}><Download size={17} aria-hidden /> Revenus (Excel)</Button>
        <Button variant="secondary" loading={busy === "incomescsv"} onClick={() => run("incomes", "csv")}><Download size={17} aria-hidden /> Revenus (CSV)</Button>
      </div>
      <Button variant="danger" className="mt-2" onClick={() => setConfirmOpen(true)}>
        Supprimer toutes mes données
      </Button>
      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Supprimer toutes vos données ?" description="Revenus, dépenses et épargne de tous les mois seront effacés définitivement. Votre compte et vos paramètres sont conservés.">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); wipe.mutate(); }}>
          <Field label="Tapez SUPPRIMER pour confirmer" htmlFor={confirmId}>
            <TextInput id={confirmId} value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" data-autofocus />
          </Field>
          <button type="submit" disabled={typed !== "SUPPRIMER" || wipe.isPending} className="h-12 rounded-2xl bg-danger font-semibold text-white disabled:opacity-40">
            {wipe.isPending ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </form>
      </Sheet>
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const [pwOpen, setPwOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { settings } = useSession();

  const logout = useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      clearLocalData();
      sessionStorage.clear();
      qc.clear();
      qc.setQueryData(qk.me, null);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="pt-1 text-center text-[26px] font-semibold tracking-tight">Paramètres</h1>

      <Section title="Profil">
        <ProfileForm />
        <Button variant="ghost" className="mt-2 -ml-2" onClick={() => setPwOpen(true)}>
          Changer de mot de passe
        </Button>
        <PasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
      </Section>

      <Section
        title="Revenus habituels"
        description={`Utilisés seulement quand vous les appliquez à un mois (${formatEUR(settings.defaultAlternanceCents + settings.defaultFreelanceCents)} au total). Les modifier ne change aucun mois déjà saisi.`}
      >
        <IncomeDefaults />
      </Section>

      <Section title="Moyens de paiement" description="Un moyen masqué n'apparaît plus lors de la saisie ; les anciennes dépenses le conservent.">
        <PaymentMethods />
      </Section>

      <Section title="Catégories" description="Dix catégories larges, volontairement sans sous-catégories.">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
          {CATEGORIES.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[15px]">
              <span aria-hidden>{c.emoji}</span> {c.label}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Devise">
        <p className="text-[15px]">Euro (€). Montants affichés au format français : 1 202,00 €.</p>
      </Section>

      <Section title="Apparence">
        <ThemePicker />
      </Section>

      <Section title="Données">
        <DataManagement />
      </Section>

      <Button variant="secondary" size="lg" onClick={() => setLogoutOpen(true)}>
        <LogOut size={18} aria-hidden /> Se déconnecter
      </Button>
      <ConfirmSheet
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Se déconnecter ?"
        message="Vous devrez saisir à nouveau votre e-mail et votre mot de passe."
        confirmLabel="Se déconnecter"
        loading={logout.isPending}
        onConfirm={() => logout.mutate()}
      />
      <p className="pb-2 text-center text-[13px] text-faint">O-Budget 1.0</p>
    </div>
  );
}
