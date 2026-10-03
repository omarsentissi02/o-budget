import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, X } from "lucide-react";
import { CATEGORIES, getCategory, type CategoryId } from "../../shared/categories";
import { COUNTRIES, FRENCH_CITIES, flagEmoji } from "../../shared/countries";
import { centsToInput, formatEUR, parseAmountToCents } from "../../shared/money";
import { addDays, dayFull, dayLabel, isValidISODate, todayISO } from "../../shared/month";
import type { ExpenseEntryDTO, LocationDTO } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { qk, useRefreshFinance, useSession } from "../lib/queries";
import { readLast, writeLast } from "../lib/prefs";
import { useSelectedMonth } from "../hooks/MonthContext";
import { AmountInput, Button, ErrorState, Skeleton, TextInput, inputClass, useFieldId } from "../components/ui";

const STEPS = ["Date", "Lieu", "Catégories", "Paiement", "Description"] as const;
const OTHER = "__other__";

interface Draft {
  date: string;
  location: LocationDTO | null;
  amounts: Partial<Record<CategoryId, string>>;
  order: CategoryId[];
  paymentMethodId: string | null | undefined; // undefined = pas encore choisi, null = « Autre »
  description: string;
}

function draftFromEntry(e: ExpenseEntryDTO): Draft {
  return {
    date: e.date,
    location: e.location,
    amounts: Object.fromEntries(e.amounts.map((a) => [a.categoryId, centsToInput(a.amountCents)])),
    order: e.amounts.map((a) => a.categoryId),
    paymentMethodId: e.paymentMethodId,
    description: e.description ?? "",
  };
}

function Tile({
  selected,
  onClick,
  children,
  className = "",
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  role?: string;
  "aria-checked"?: boolean;
  "aria-pressed"?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 text-left text-[16px] font-medium transition active:scale-[0.98] ${
        selected ? "border-accent bg-accent-soft" : "border-transparent bg-surface hover:border-line"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function Wizard({ initial, entryId }: { initial: Draft; entryId?: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshFinance();
  const { setMonth } = useSelectedMonth();
  const { paymentMethods } = useSession();
  const methods = paymentMethods.filter((m) => !m.archived || m.id === initial.paymentMethodId);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Lieu : mode et saisies libres
  const [where, setWhere] = useState<"france" | "abroad">(initial.location?.type ?? "france");
  const initialCity = initial.location?.type === "france" ? initial.location.city : "";
  const [otherCity, setOtherCity] = useState(
    initialCity && !(FRENCH_CITIES as readonly string[]).includes(initialCity) ? initialCity : "",
  );
  const initialAbroad = initial.location?.type === "abroad" ? initial.location : null;
  const [otherCountry, setOtherCountry] = useState(initialAbroad && !initialAbroad.countryCode ? initialAbroad.countryName : "");
  const [cityMode, setCityMode] = useState<string>(
    initialCity ? ((FRENCH_CITIES as readonly string[]).includes(initialCity) ? initialCity : OTHER) : "",
  );
  const [countryMode, setCountryMode] = useState<string>(initialAbroad ? (initialAbroad.countryCode ?? OTHER) : "");
  const [countryQuery, setCountryQuery] = useState("");

  const dateId = useFieldId("date");
  const descId = useFieldId("desc");

  const parsed = draft.order.map((id) => ({ categoryId: id, cents: parseAmountToCents(draft.amounts[id] ?? "") }));
  const totalCents = parsed.reduce((s, p) => s + (p.cents ?? 0), 0);
  const amountsValid = parsed.length > 0 && parsed.every((p) => p.cents !== null && p.cents > 0);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const go = (to: number) => {
    setError(null);
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  const setLocation = (location: LocationDTO | null, advance = false) => {
    setDraft((d) => ({ ...d, location }));
    if (advance && location) go(2);
  };

  const toggleCategory = (id: CategoryId) =>
    setDraft((d) =>
      d.order.includes(id)
        ? { ...d, order: d.order.filter((x) => x !== id), amounts: { ...d.amounts, [id]: undefined } }
        : { ...d, order: [...d.order, id] },
    );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        date: draft.date,
        location: draft.location,
        amounts: parsed.map((p) => ({ categoryId: p.categoryId, amountCents: p.cents })),
        paymentMethodId: draft.paymentMethodId ?? null,
        description: draft.description.trim() || null,
        ...(entryId ? {} : { clientRequestId: requestId.current }),
      };
      return entryId
        ? api<ExpenseEntryDTO>(`/expenses/${entryId}`, { method: "PUT", body })
        : api<ExpenseEntryDTO>("/expenses", { method: "POST", body });
    },
    onSuccess: async (entry) => {
      writeLast({ location: entry.location, paymentMethodId: entry.paymentMethodId });
      setMonth(entry.date.slice(0, 7));
      setDone(true);
      await refresh();
      setTimeout(() => (entryId ? navigate(-1) : navigate("/", { replace: true })), 950);
    },
    onError: (e) => setError(errorMessage(e) || "Impossible d'enregistrer la dépense. Vérifiez le montant."),
  });

  const canNext = [
    isValidISODate(draft.date),
    draft.location !== null,
    amountsValid,
    draft.paymentMethodId !== undefined,
    true,
  ][step];

  const next = () => {
    if (step === 2 && !amountsValid) {
      setError(parsed.length === 0 ? "Choisissez au moins une catégorie." : "Impossible d'enregistrer la dépense. Vérifiez le montant.");
      return;
    }
    if (step < STEPS.length - 1) go(step + 1);
    else if (!save.isPending) save.mutate();
  };

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    return q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q)) : COUNTRIES;
  }, [countryQuery]);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-canvas" role="status" aria-live="assertive">
        <div className="anim-pop flex flex-col items-center gap-4">
          <div className="grid size-20 place-items-center rounded-full bg-save text-white">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path className="check-path" d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-xl font-semibold">{entryId ? "Dépense modifiée" : "Dépense enregistrée"}</p>
          <p className="num text-muted">{formatEUR(totalCents)}</p>
        </div>
      </div>
    );
  }

  const anim = { "--step-from": dir === 1 ? "18px" : "-18px" } as React.CSSProperties;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col pt-safe">
      <header className="sticky top-0 z-10 bg-canvas/90 px-4 pt-3 pb-2 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => (step === 0 ? navigate(-1) : go(step - 1))}
            aria-label={step === 0 ? "Fermer" : "Étape précédente"}
            className="grid size-11 place-items-center rounded-full bg-surface text-muted hover:text-ink"
          >
            {step === 0 ? <X size={22} /> : <ArrowLeft size={22} />}
          </button>
          <p className="text-sm font-medium text-muted">
            {entryId ? "Modifier la dépense" : "Nouvelle dépense"}
          </p>
          {step > 0 ? (
            <button type="button" onClick={() => navigate(-1)} aria-label="Annuler" className="grid size-11 place-items-center rounded-full text-muted hover:text-ink">
              <X size={22} />
            </button>
          ) : (
            <span className="size-11" />
          )}
        </div>
        <ol className="mt-3 flex gap-1.5" aria-label={`Étape ${step + 1} sur ${STEPS.length} : ${STEPS[step]}`}>
          {STEPS.map((s, i) => (
            <li key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-accent" : "bg-line"}`} />
          ))}
        </ol>
      </header>

      <main className="flex-1 px-4 pt-4 pb-40">
        <div key={step} className="anim-step" style={anim}>
          {step === 0 && (
            <section>
              <h1 ref={headingRef} tabIndex={-1} className="mb-1 text-[28px] font-semibold tracking-tight outline-none">
                Quand ?
              </h1>
              <p className="mb-6 text-muted">{dayFull(draft.date)}</p>
              <div className="mb-5 grid grid-cols-3 gap-2">
                {[
                  ["Aujourd'hui", todayISO()],
                  ["Hier", addDays(todayISO(), -1)],
                  ["Avant-hier", addDays(todayISO(), -2)],
                ].map(([label, iso]) => (
                  <Tile key={label} selected={draft.date === iso} onClick={() => setDraft((d) => ({ ...d, date: iso }))} className="justify-center text-[15px]" aria-pressed={draft.date === iso}>
                    {label}
                  </Tile>
                ))}
              </div>
              <label htmlFor={dateId} className="mb-1.5 block text-sm font-medium text-muted">
                Autre date
              </label>
              <input
                id={dateId}
                type="date"
                value={draft.date}
                max={addDays(todayISO(), 31)}
                onChange={(e) => e.target.value && setDraft((d) => ({ ...d, date: e.target.value }))}
                className={inputClass}
              />
              <p className="mt-2 text-sm text-faint">{dayLabel(draft.date)}</p>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 ref={headingRef} tabIndex={-1} className="mb-6 text-[28px] font-semibold tracking-tight outline-none">
                Où avez-vous dépensé ?
              </h1>
              <div className="mb-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pays">
                <Tile selected={where === "france"} role="radio" aria-checked={where === "france"} onClick={() => { setWhere("france"); setLocation(null); setCityMode(""); }}>
                  <span aria-hidden className="text-2xl">🇫🇷</span> France
                </Tile>
                <Tile selected={where === "abroad"} role="radio" aria-checked={where === "abroad"} onClick={() => { setWhere("abroad"); setLocation(null); setCountryMode(""); }}>
                  <span aria-hidden className="text-2xl">🌍</span> Autre pays
                </Tile>
              </div>

              {where === "france" ? (
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Ville">
                  {FRENCH_CITIES.map((city) => (
                    <Tile key={city} role="radio" aria-checked={cityMode === city} selected={cityMode === city} onClick={() => { setCityMode(city); setLocation({ type: "france", city }, true); }}>
                      {city}
                    </Tile>
                  ))}
                  <Tile role="radio" aria-checked={cityMode === OTHER} selected={cityMode === OTHER} onClick={() => { setCityMode(OTHER); setLocation(otherCity.trim() ? { type: "france", city: otherCity.trim() } : null); }}>
                    Autre ville
                  </Tile>
                  {cityMode === OTHER && (
                    <div className="anim-fade mt-2">
                      <label htmlFor="other-city" className="mb-1.5 block text-sm font-medium text-muted">Ville</label>
                      <TextInput
                        id="other-city"
                        autoFocus
                        maxLength={80}
                        placeholder="Ex. Lyon"
                        value={otherCity}
                        onChange={(e) => {
                          setOtherCity(e.target.value);
                          setLocation(e.target.value.trim() ? { type: "france", city: e.target.value.trim() } : null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && otherCity.trim() && go(2)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label htmlFor="country-search" className="sr-only">Rechercher un pays</label>
                  <TextInput id="country-search" placeholder="Rechercher un pays" value={countryQuery} onChange={(e) => setCountryQuery(e.target.value)} className="mb-3" />
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pays de la dépense">
                    {filteredCountries.map((c) => (
                      <Tile key={c.code} role="radio" aria-checked={countryMode === c.code} selected={countryMode === c.code} onClick={() => { setCountryMode(c.code); setLocation({ type: "abroad", countryCode: c.code, countryName: c.name }, true); }} className="text-[15px]">
                        <span aria-hidden className="text-xl">{flagEmoji(c.code)}</span>
                        <span className="truncate">{c.name}</span>
                      </Tile>
                    ))}
                    <Tile role="radio" aria-checked={countryMode === OTHER} selected={countryMode === OTHER} onClick={() => { setCountryMode(OTHER); setLocation(otherCountry.trim() ? { type: "abroad", countryCode: null, countryName: otherCountry.trim() } : null); }} className="text-[15px]">
                      <span aria-hidden className="text-xl">🌍</span> Autre
                    </Tile>
                  </div>
                  {countryMode === OTHER && (
                    <div className="anim-fade mt-3">
                      <label htmlFor="other-country" className="mb-1.5 block text-sm font-medium text-muted">Pays</label>
                      <TextInput
                        id="other-country"
                        autoFocus
                        maxLength={80}
                        placeholder="Ex. Mexique"
                        value={otherCountry}
                        onChange={(e) => {
                          setOtherCountry(e.target.value);
                          setLocation(e.target.value.trim() ? { type: "abroad", countryCode: null, countryName: e.target.value.trim() } : null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && otherCountry.trim() && go(2)}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 ref={headingRef} tabIndex={-1} className="mb-1 text-[28px] font-semibold tracking-tight outline-none">
                Pour quoi ?
              </h1>
              <p className="mb-5 text-muted">Choisissez une ou plusieurs catégories, puis le montant de chacune.</p>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((c) => {
                  const on = draft.order.includes(c.id);
                  return (
                    <Tile key={c.id} selected={on} onClick={() => toggleCategory(c.id)} aria-pressed={on} className="gap-2 px-3 text-[14px] min-[400px]:gap-2.5 min-[400px]:px-3.5 min-[400px]:text-[15px]">
                      <span aria-hidden className="shrink-0 text-xl">{c.emoji}</span>
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    </Tile>
                  );
                })}
              </div>

              {draft.order.length > 0 && (
                <div className="mt-6 flex flex-col gap-3">
                  {draft.order.map((id, idx) => {
                    const c = getCategory(id);
                    const inputId = `amount-${id}`;
                    return (
                      <div key={id} className="anim-fade flex items-center gap-3 rounded-2xl bg-surface p-3 pl-4">
                        <label htmlFor={inputId} className="flex flex-1 items-center gap-2 text-[15px] font-medium">
                          <span aria-hidden className="text-xl">{c.emoji}</span> {c.label}
                        </label>
                        <AmountInput
                          id={inputId}
                          className="w-36"
                          autoFocus={idx === draft.order.length - 1}
                          value={draft.amounts[id] ?? ""}
                          onChange={(v) => setDraft((d) => ({ ...d, amounts: { ...d.amounts, [id]: v } }))}
                          aria-invalid={draft.amounts[id] !== undefined && draft.amounts[id] !== "" && !parseAmountToCents(draft.amounts[id] ?? "")}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 ref={headingRef} tabIndex={-1} className="mb-6 text-[28px] font-semibold tracking-tight outline-none">
                Comment avez-vous payé ?
              </h1>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Moyen de paiement">
                {methods.map((m) => (
                  <Tile key={m.id} role="radio" aria-checked={draft.paymentMethodId === m.id} selected={draft.paymentMethodId === m.id} onClick={() => { setDraft((d) => ({ ...d, paymentMethodId: m.id })); go(4); }}>
                    {m.name}
                  </Tile>
                ))}
                <Tile role="radio" aria-checked={draft.paymentMethodId === null} selected={draft.paymentMethodId === null} onClick={() => { setDraft((d) => ({ ...d, paymentMethodId: null })); go(4); }}>
                  Autre
                </Tile>
              </div>
            </section>
          )}

          {step === 4 && (
            <section>
              <h1 ref={headingRef} tabIndex={-1} className="mb-6 text-[28px] font-semibold tracking-tight outline-none">
                Une description ?
              </h1>
              <label htmlFor={descId} className="mb-1.5 block text-sm font-medium text-muted">
                Description (facultatif)
              </label>
              <TextInput
                id={descId}
                maxLength={200}
                placeholder="Ex. Courses, Déjeuner, Train Montpellier-Paris"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && next()}
              />

              <div className="mt-6 rounded-[26px] bg-surface p-5">
                <dl className="flex flex-col gap-2 text-[15px]">
                  <div className="flex justify-between gap-4"><dt className="text-muted">Date</dt><dd>{dayFull(draft.date)}</dd></div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Lieu</dt>
                    <dd className="truncate">{draft.location?.type === "france" ? `${draft.location.city}, France` : draft.location?.countryName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Paiement</dt>
                    <dd>{draft.paymentMethodId === null ? "Autre" : methods.find((m) => m.id === draft.paymentMethodId)?.name}</dd>
                  </div>
                </dl>
                <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4">
                  {parsed.map((p) => {
                    const c = getCategory(p.categoryId);
                    return (
                      <li key={p.categoryId} className="flex justify-between text-[15px]">
                        <span><span aria-hidden>{c.emoji}</span> {c.label}</span>
                        <span className="num">{formatEUR(p.cents ?? 0)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-line/70 bg-canvas/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur-xl">
        <div className="mx-auto max-w-lg">
          {error && (
            <p role="alert" className="mb-2 text-center text-sm font-medium text-danger">
              {error}
            </p>
          )}
          {step >= 2 && (
            <p className="mb-2 flex items-baseline justify-between text-[15px]">
              <span className="text-muted">Total</span>
              <span className="num text-xl font-semibold">{formatEUR(totalCents)}</span>
            </p>
          )}
          <Button size="lg" block onClick={next} disabled={!canNext && step !== 2} loading={save.isPending}>
            {step === STEPS.length - 1 ? "Enregistrer" : "Suivant"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

export default function ExpenseWizard() {
  const { id } = useParams();
  const { paymentMethods } = useSession();
  const entry = useQuery({
    queryKey: qk.expense(id ?? ""),
    queryFn: () => api<ExpenseEntryDTO>(`/expenses/${id}`),
    enabled: !!id,
  });

  if (id) {
    if (entry.isError)
      return (
        <div className="mx-auto max-w-lg p-4 pt-16">
          <ErrorState message={errorMessage(entry.error)} onRetry={() => entry.refetch()} />
        </div>
      );
    if (!entry.data)
      return (
        <div className="mx-auto max-w-lg p-4 pt-16">
          <Skeleton className="h-96" />
        </div>
      );
    return <Wizard key={id} initial={draftFromEntry(entry.data)} entryId={id} />;
  }

  // Nouvelle dépense : on reprend le dernier lieu et le dernier moyen de paiement utilisés.
  const last = readLast();
  const lastMethodValid = last.paymentMethodId === null || paymentMethods.some((m) => m.id === last.paymentMethodId && !m.archived);
  return (
    <Wizard
      initial={{
        date: todayISO(),
        location: last.location ?? null,
        amounts: {},
        order: [],
        paymentMethodId: lastMethodValid ? last.paymentMethodId : undefined,
        description: "",
      }}
    />
  );
}
