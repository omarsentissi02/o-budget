import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, ShieldCheck, ShieldQuestion, Trash2, X } from "lucide-react";
import { SELECTABLE_CATEGORIES, type CategoryId } from "../../shared/categories";
import { COUNTRIES, FRENCH_CITIES } from "../../shared/countries";
import { rankMerchants, type MerchantView } from "../../shared/merchants";
import { centsToInput, parseAmountToCents } from "../../shared/money";
import { isValidISODate, todayInZone } from "../../shared/month";
import { CHANNELS, PLATFORMS, subcategoriesOf } from "../../shared/taxonomy";
import type { ExpenseEntryDTO, LocationDTO } from "../../shared/types";
import { api, errorMessage, FormError, post, put } from "../lib/api";
import { qk, useSession, useTaxonomy, useAction } from "../lib/queries";
import { readLast, writeLast } from "../lib/prefs";
import { useSelectedMonth } from "../hooks/MonthContext";
import { Sheet } from "../components/Sheet";
import { AmountInput, Button, ErrorState, Field, Skeleton, TextInput } from "../components/ui";
import { Select, money } from "../components/v2";

interface Line {
  uid: string; categoryId: CategoryId | ""; amount: string; subcategoryId: string; merchantId: string; merchantLabel: string;
  platformId: string; tripFrom: string; tripTo: string; tripDate: string; note: string;
}
const newLine = (over: Partial<Line> = {}): Line => ({ uid: crypto.randomUUID(), categoryId: "", amount: "", subcategoryId: "", merchantId: "", merchantLabel: "", platformId: "", tripFrom: "", tripTo: "", tripDate: "", note: "", ...over });
const OTHER = "__other__";

function HalalBadge({ m, onEdit }: { m: MerchantView; onEdit: () => void }) {
  if (m.halalStatus === null) return null;
  const verified = m.halalStatus === "verified";
  return (
    <div className="flex items-start gap-2 rounded-xl bg-raised/70 p-3 text-sm">
      {verified ? <ShieldCheck size={18} className="mt-0.5 shrink-0 text-save" aria-hidden /> : <ShieldQuestion size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">Halal : {verified ? "vérifié" : m.halalStatus === "claimed" ? "déclaré, non vérifié" : "non renseigné"}</p>
        {verified && m.halalSource && <p className="text-xs text-muted">Source : {m.halalSource}</p>}
        <p className="text-xs text-faint">Information saisie par vous, jamais déduite du nom de l'établissement.</p>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 font-semibold text-accent">Modifier</button>
    </div>
  );
}

function HalalSheet({ merchant, onClose }: { merchant: MerchantView | null; onClose: () => void }) {
  const [status, setStatus] = useState<string>(merchant?.halalStatus ?? "unknown");
  const [source, setSource] = useState(merchant?.halalSource ?? "");
  const save = useAction(async () => {
    if (!merchant) return;
    if (status === "verified" && !source.trim()) throw new FormError("Indiquez la source de la vérification (certificat, site officiel, note…).");
    return put(`/merchants/${merchant.id}/halal`, { halalStatus: status, halalSource: source.trim() || null });
  }, { keys: ["taxonomy"], success: "Statut halal enregistré", onDone: onClose });
  return (
    <Sheet open={!!merchant} onClose={onClose} title={merchant ? `Halal · ${merchant.label}` : ""}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined as never); }}>
        <Field label="Statut" htmlFor="hs"><Select id="hs" value={status} onChange={setStatus}><option value="unknown">Non renseigné</option><option value="claimed">Déclaré (non vérifié)</option><option value="verified">Vérifié</option></Select></Field>
        {status === "verified" && <Field label="Source de la vérification" htmlFor="hsrc"><TextInput id="hsrc" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Certificat, site officiel, note personnelle…" maxLength={200} /></Field>}
        <Button type="submit" loading={save.isPending}>Enregistrer</Button>
      </form>
    </Sheet>
  );
}

function LineEditor({ line, set, onRemove, canRemove, single }: { line: Line; set: (p: Partial<Line>) => void; onRemove: () => void; canRemove: boolean; single: boolean }) {
  const tax = useTaxonomy();
  const [query, setQuery] = useState("");
  const [halalFor, setHalalFor] = useState<MerchantView | null>(null);
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState("");
  const cat = line.categoryId || undefined;
  const subs = useMemo(() => {
    if (!cat) return [];
    const custom = (tax.data?.customSubcategories ?? []).filter((s) => s.categoryId === cat).map((s) => ({ id: s.id, label: s.label, merchant: false, platform: false, trip: false }));
    return [...subcategoriesOf(cat).map((s) => ({ id: s.id, label: s.label, merchant: !!s.merchant, platform: !!s.platform, trip: !!s.trip })), ...custom];
  }, [cat, tax.data]);
  const sub = subs.find((s) => s.id === line.subcategoryId);
  const merchants = tax.data?.merchants ?? [];
  const chosen = merchants.find((m) => m.id === line.merchantId);
  const ranked = useMemo(() => rankMerchants(merchants, { categoryId: cat, subcategoryId: line.subcategoryId || null, query }).slice(0, query ? 8 : 6), [merchants, cat, line.subcategoryId, query]);

  const addMerchant = useAction(() => post<MerchantView>("/merchants", { label: query.trim(), categoryId: cat ?? null, subcategoryId: line.subcategoryId || null }), {
    keys: ["taxonomy"], onDone: (m) => { set({ merchantId: m.id, merchantLabel: m.label }); setQuery(""); },
  });
  const addSub = useAction(() => post<{ id: string }>("/subcategories", { categoryId: cat, label: subName.trim() }), {
    keys: ["taxonomy"], onDone: (s) => { set({ subcategoryId: s.id }); setSubName(""); setAddingSub(false); },
  });
  const showMerchant = !!sub?.merchant;

  return (
    <fieldset className="flex flex-col gap-4 rounded-[26px] bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-semibold text-muted">{single ? "Dépense" : "Ligne de dépense"}</legend>
        {canRemove && <button type="button" onClick={onRemove} aria-label="Retirer cette ligne" className="grid size-9 place-items-center rounded-full text-muted hover:bg-raised"><Trash2 size={18} /></button>}
      </div>
      <Field label="Montant" htmlFor={`amt-${line.uid}`}><AmountInput id={`amt-${line.uid}`} large value={line.amount} onChange={(v) => set({ amount: v })} data-autofocus={single || undefined} /></Field>

      <div>
        <p className="mb-2 text-sm font-medium text-muted">Catégorie</p>
        <div role="radiogroup" aria-label="Catégorie" className="grid grid-cols-3 gap-2">
          {SELECTABLE_CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={line.categoryId === c.id} onClick={() => set({ categoryId: c.id, subcategoryId: "", merchantId: "", merchantLabel: "", platformId: "", tripFrom: "", tripTo: "", tripDate: "" })} className={`flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-1 text-center text-xs font-semibold transition ${line.categoryId === c.id ? "border-accent bg-accent-soft" : "border-transparent bg-raised"}`}>
              <span aria-hidden className="text-xl">{c.emoji}</span>{c.label}
            </button>
          ))}
        </div>
      </div>

      {cat && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted">Précision <span className="font-normal text-faint">(facultatif)</span></p>
          <div className="flex flex-wrap gap-2">
            {subs.map((s) => <button key={s.id} type="button" aria-pressed={line.subcategoryId === s.id} onClick={() => set({ subcategoryId: line.subcategoryId === s.id ? "" : s.id, merchantId: "", merchantLabel: "", platformId: "" })} className={`h-10 rounded-full px-4 text-sm font-semibold ${line.subcategoryId === s.id ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>{s.label}</button>)}
            <button type="button" onClick={() => setAddingSub(true)} className="inline-flex h-10 items-center gap-1 rounded-full border border-dashed border-line px-4 text-sm font-semibold text-muted"><Plus size={14} aria-hidden /> Autre</button>
          </div>
          {addingSub && (
            <div className="mt-2 flex gap-2"><TextInput aria-label="Nom de la sous-catégorie" value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Nouvelle sous-catégorie" maxLength={40} /><Button type="button" disabled={!subName.trim()} loading={addSub.isPending} onClick={() => addSub.mutate(undefined as never)}>Ajouter</Button></div>
          )}
        </div>
      )}

      {showMerchant && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted">Établissement <span className="font-normal text-faint">(facultatif)</span></p>
          {chosen || line.merchantLabel ? (
            <div className="flex items-center justify-between rounded-2xl bg-accent-soft px-4 py-3"><span className="font-semibold">{chosen?.label ?? line.merchantLabel}</span><button type="button" aria-label="Retirer l'établissement" onClick={() => set({ merchantId: "", merchantLabel: "", platformId: "" })}><X size={18} aria-hidden /></button></div>
          ) : (
            <>
              <TextInput aria-label="Rechercher un établissement" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher ou ajouter…" maxLength={60} />
              <ul className="mt-2 flex flex-wrap gap-2">
                {ranked.map((m) => <li key={m.id}><button type="button" onClick={() => set({ merchantId: m.id, merchantLabel: m.label })} className="h-10 rounded-full bg-raised px-4 text-sm font-semibold">{m.label}</button></li>)}
                {query.trim().length > 1 && !merchants.some((m) => m.label.toLowerCase() === query.trim().toLowerCase()) && <li><button type="button" onClick={() => addMerchant.mutate(undefined as never)} className="inline-flex h-10 items-center gap-1 rounded-full border border-dashed border-accent px-4 text-sm font-semibold text-accent"><Plus size={14} aria-hidden /> Ajouter « {query.trim()} »</button></li>}
              </ul>
            </>
          )}
          {chosen && <div className="mt-2"><HalalBadge m={chosen} onEdit={() => setHalalFor(chosen)} /></div>}
        </div>
      )}

      {sub?.platform && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted">Plateforme de commande</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={line.platformId === ""} onClick={() => set({ platformId: "" })} className={`h-10 rounded-full px-4 text-sm font-semibold ${line.platformId === "" ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>Aucune</button>
            {PLATFORMS.map((p) => <button key={p.id} type="button" aria-pressed={line.platformId === p.id} onClick={() => set({ platformId: p.id })} className={`h-10 rounded-full px-4 text-sm font-semibold ${line.platformId === p.id ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>{p.label}</button>)}
          </div>
        </div>
      )}

      {sub?.trip && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Départ" htmlFor={`tf-${line.uid}`}><TextInput id={`tf-${line.uid}`} value={line.tripFrom} onChange={(e) => set({ tripFrom: e.target.value })} maxLength={80} placeholder="Paris" /></Field>
          <Field label="Destination" htmlFor={`tt-${line.uid}`}><TextInput id={`tt-${line.uid}`} value={line.tripTo} onChange={(e) => set({ tripTo: e.target.value })} maxLength={80} placeholder="Montpellier" /></Field>
          <div className="col-span-2"><Field label="Date du voyage" htmlFor={`td-${line.uid}`}><TextInput id={`td-${line.uid}`} type="date" value={line.tripDate} onChange={(e) => set({ tripDate: e.target.value })} /></Field></div>
        </div>
      )}
      <HalalSheet key={halalFor?.id ?? "none"} merchant={halalFor} onClose={() => setHalalFor(null)} />
    </fieldset>
  );
}

function Form({ initial, entryId }: { initial: { date: string; location: LocationDTO | null; paymentMethodId: string | null | undefined; description: string; notes: string; channel: string; lines: Line[] }; entryId?: string }) {
  const navigate = useNavigate();
  const { setMonth } = useSelectedMonth();
  const { paymentMethods, settings } = useSession();
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [date, setDate] = useState(initial.date);
  const [where, setWhere] = useState<"france" | "abroad">(initial.location?.type ?? "france");
  const [city, setCity] = useState(initial.location?.type === "france" ? initial.location.city : "");
  const [country, setCountry] = useState(initial.location?.type === "abroad" ? initial.location.countryCode ?? OTHER : "");
  const [otherCountry, setOtherCountry] = useState(initial.location?.type === "abroad" && !initial.location.countryCode ? initial.location.countryName : "");
  const [pm, setPm] = useState<string | null | undefined>(initial.paymentMethodId);
  const [description, setDescription] = useState(initial.description);
  const [notes, setNotes] = useState(initial.notes);
  const [channel, setChannel] = useState(initial.channel);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const methods = paymentMethods.filter((m) => !m.archived || m.id === initial.paymentMethodId);

  const setLine = (uid: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...p } : l)));
  const parsed = lines.map((l) => parseAmountToCents(l.amount));
  const total = parsed.reduce<number>((s, c) => s + (c ?? 0), 0);

  const save = useAction(async () => {
    if (!isValidISODate(date)) throw new FormError("Choisissez une date valide.");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].categoryId) throw new FormError("Choisissez une catégorie.");
      if (parsed[i] === null || parsed[i]! <= 0) throw new FormError("Impossible d'enregistrer la dépense. Vérifiez le montant.");
    }
    if (new Set(lines.map((l) => l.categoryId)).size !== lines.length) throw new FormError("Une catégorie ne peut apparaître qu'une fois : regroupez les montants.");
    let location: LocationDTO;
    if (where === "france") {
      if (!city.trim()) throw new FormError("Indiquez la ville.");
      location = { type: "france", city: city.trim() };
    } else {
      if (!country) throw new FormError("Choisissez le pays.");
      if (country === OTHER) {
        if (!otherCountry.trim()) throw new FormError("Indiquez le pays.");
        location = { type: "abroad", countryCode: null, countryName: otherCountry.trim() };
      } else location = { type: "abroad", countryCode: country, countryName: COUNTRIES.find((c) => c.code === country)?.name ?? country };
    }
    if (pm === undefined) throw new FormError("Choisissez le moyen de paiement.");
    const body = {
      date, location, paymentMethodId: pm,
      description: description.trim() || null, notes: notes.trim() || null, channel: channel || null,
      amounts: lines.map((l, i) => ({
        categoryId: l.categoryId, amountCents: parsed[i], subcategoryId: l.subcategoryId || null,
        merchantId: l.merchantId || null, platformId: l.platformId || null,
        tripFrom: l.tripFrom.trim() || null, tripTo: l.tripTo.trim() || null, tripDate: l.tripDate || null, note: l.note.trim() || null,
      })),
      ...(entryId ? {} : { clientRequestId: requestId.current }),
    };
    return entryId ? put<ExpenseEntryDTO>(`/expenses/${entryId}`, body) : post<ExpenseEntryDTO>("/expenses", body);
  }, {
    success: entryId ? "Dépense modifiée" : "Dépense enregistrée",
    onDone: (entry) => { const e = entry as ExpenseEntryDTO; writeLast({ location: e.location, paymentMethodId: e.paymentMethodId }); setMonth(e.date.slice(0, 7)); if (entryId) navigate(-1); else navigate("/", { replace: true }); },
  });

  const usedCats = new Set(lines.map((l) => l.categoryId));
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+110px)]">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Retour" className="grid size-11 place-items-center rounded-full bg-surface"><ArrowLeft size={20} /></button>
        <h1 className="text-[22px] font-semibold tracking-tight">{entryId ? "Modifier la dépense" : "Nouvelle dépense"}</h1>
      </header>

      {lines.map((l) => <LineEditor key={l.uid} line={l} set={(p) => setLine(l.uid, p)} single={lines.length === 1} canRemove={lines.length > 1} onRemove={() => setLines((ls) => ls.filter((x) => x.uid !== l.uid))} />)}
      {lines.length < SELECTABLE_CATEGORIES.length && usedCats.size === lines.length && (
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine()])}><Plus size={18} aria-hidden /> Ajouter une autre catégorie (ticket mixte)</Button>
      )}
      {lines.length > 1 && <p className="px-1 text-sm text-muted">Total : <span className="num font-semibold text-ink">{money(total)}</span></p>}

      <section className="flex flex-col gap-4 rounded-[26px] bg-surface p-4" aria-label="Détails">
        <Field label="Date" htmlFor="xd"><TextInput id="xd" type="date" value={date} max={todayInZone(settings.timezone)} onChange={(e) => setDate(e.target.value)} /></Field>
        <div>
          <p className="mb-2 text-sm font-medium text-muted">Lieu</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(["france", "abroad"] as const).map((w) => <button key={w} type="button" aria-pressed={where === w} onClick={() => setWhere(w)} className={`h-11 rounded-xl text-sm font-semibold ${where === w ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>{w === "france" ? "France" : "Étranger"}</button>)}
          </div>
          {where === "france" ? (
            <>
              <TextInput aria-label="Ville" value={city} onChange={(e) => setCity(e.target.value)} list="cities" placeholder="Ville" maxLength={60} />
              <datalist id="cities">{FRENCH_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Select label="Pays" value={country} onChange={setCountry}><option value="">Choisir un pays</option>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}<option value={OTHER}>Autre pays…</option></Select>
              {country === OTHER && <TextInput aria-label="Nom du pays" value={otherCountry} onChange={(e) => setOtherCountry(e.target.value)} placeholder="Pays" maxLength={60} />}
            </div>
          )}
        </div>
        <Field label="Payé avec" htmlFor="xp">
          <Select id="xp" value={pm === undefined ? "__unset__" : pm === null ? "__none__" : pm} onChange={(v) => setPm(v === "__unset__" ? undefined : v === "__none__" ? null : v)}>
            <option value="__unset__" disabled>Choisir…</option>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}<option value="__none__">Autre</option>
          </Select>
        </Field>
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold text-accent">Plus de détails</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Field label="Description" htmlFor="xdesc"><TextInput id="xdesc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></Field>
            <div>
              <p className="mb-2 text-sm font-medium text-muted">Mode d'achat</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={channel === ""} onClick={() => setChannel("")} className={`h-10 rounded-full px-4 text-sm font-semibold ${channel === "" ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>Non précisé</button>
                {CHANNELS.map((c) => <button key={c.id} type="button" aria-pressed={channel === c.id} onClick={() => setChannel(c.id)} className={`h-10 rounded-full px-4 text-sm font-semibold ${channel === c.id ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>{c.label}</button>)}
              </div>
            </div>
            <Field label="Notes" htmlFor="xn"><TextInput id="xn" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
          </div>
        </details>
      </section>
      {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-canvas/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur-xl">
        <div className="mx-auto max-w-lg">
          <Button size="lg" block loading={save.isPending} onClick={() => { setError(null); save.mutate(undefined as never, { onError: (e) => setError(errorMessage(e)) }); }}>
            {entryId ? "Enregistrer les modifications" : total > 0 ? `Enregistrer ${money(total)}` : "Enregistrer"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

const fromEntry = (e: ExpenseEntryDTO) => ({
  date: e.date, location: e.location, paymentMethodId: e.paymentMethodId as string | null | undefined, description: e.description ?? "", notes: e.notes ?? "", channel: e.channel ?? "",
  lines: e.amounts.map((a) => newLine({ categoryId: a.categoryId, amount: centsToInput(a.amountCents), subcategoryId: a.subcategoryId ?? "", merchantId: a.merchantId ?? "", merchantLabel: a.merchantLabel ?? "", platformId: a.platformId ?? "", tripFrom: a.tripFrom ?? "", tripTo: a.tripTo ?? "", tripDate: a.tripDate ?? "", note: a.note ?? "" })),
});

export default function ExpenseForm() {
  const { id } = useParams();
  const { paymentMethods, settings } = useSession();
  const entry = useQuery({ queryKey: qk.expense(id ?? ""), queryFn: () => api<ExpenseEntryDTO>(`/expenses/${id}`), enabled: !!id });
  if (id) {
    if (entry.isError) return <div className="mx-auto max-w-lg p-4 pt-16"><ErrorState message={errorMessage(entry.error)} onRetry={() => entry.refetch()} /></div>;
    if (!entry.data) return <div className="mx-auto max-w-lg p-4 pt-16"><Skeleton className="h-96" /></div>;
    return <Form key={id} initial={fromEntry(entry.data)} entryId={id} />;
  }
  const last = readLast();
  const lastOk = last.paymentMethodId === null || paymentMethods.some((m) => m.id === last.paymentMethodId && !m.archived);
  return <Form initial={{ date: todayInZone(settings.timezone), location: last.location ?? null, paymentMethodId: lastOk ? last.paymentMethodId : undefined, description: "", notes: "", channel: "", lines: [newLine()] }} />;
}
