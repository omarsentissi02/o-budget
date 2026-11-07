import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Check, Send, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { AiMessageDTO, AiProposalDTO, NotificationDTO } from "../../shared/types";
import { del, errorMessage, post } from "../lib/api";
import { useAction, useAiMessages, useAiStatus, useNotifications, useRecommendations } from "../lib/queries";
import { Button, ErrorState, Panel, SectionTitle, Skeleton, TextInput } from "../components/ui";
import { ConfirmSheet } from "../components/Sheet";
import { Empty, LevelBadge, PageHeader, Pill, Tabs } from "../components/v2";
import { dayFR } from "../../shared/month";
import { priorityLabel } from "../../shared/tasks";

const TABS = [{ value: "reco", label: "Conseils" }, { value: "alertes", label: "Alertes" }, { value: "chat", label: "Conversation" }] as const;
type Tab = (typeof TABS)[number]["value"];

function Recommendations() {
  const r = useRecommendations();
  if (r.isError) return <ErrorState message={errorMessage(r.error)} onRetry={() => r.refetch()} />;
  if (!r.data) return <Skeleton className="h-40 rounded-[26px]" />;
  const groups = [["finance", "Finances"], ["productivity", "Organisation"], ["unified", "Finances et temps"]] as const;
  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-sm text-muted">Calculés par des règles fixes à partir de vos données, sans intelligence artificielle : les montants sont toujours exacts.</p>
      {r.data.recommendations.length === 0 && <Panel><Empty title="Rien à signaler">Saisissez vos revenus, dépenses et tâches pour recevoir des conseils.</Empty></Panel>}
      {groups.map(([domain, label]) => {
        const items = r.data.recommendations.filter((x) => x.domain === domain);
        return items.length === 0 ? null : (
          <Panel key={domain} aria-labelledby={`rc-${domain}`}>
            <SectionTitle id={`rc-${domain}`}>{label}</SectionTitle>
            <ul className="flex flex-col gap-3">
              {items.map((x, i) => (
                <li key={i} className="rounded-2xl bg-raised/60 p-3"><LevelBadge level={x.level} /><p className="mt-1.5 text-[15px] font-semibold">{x.title}</p><p className="text-sm text-muted">{x.body}</p></li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function Alerts() {
  const n = useNotifications();
  const refresh = useAction(() => post("/notifications/refresh"), { keys: ["notifications", "overview"], success: "Alertes actualisées" });
  const readAll = useAction(() => post("/notifications/read-all"), { keys: ["notifications", "overview"] });
  const act = useAction((v: { id: string; action: "read" | "dismiss" }) => post(`/notifications/${v.id}`, { action: v.action }), { keys: ["notifications", "overview"] });
  if (n.isError) return <ErrorState message={errorMessage(n.error)} onRetry={() => n.refetch()} />;
  if (!n.data) return <Skeleton className="h-40 rounded-[26px]" />;
  const unread = n.data.filter((x: NotificationDTO) => !x.readAt).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant="secondary" loading={refresh.isPending} onClick={() => refresh.mutate(undefined as never)}>Actualiser</Button>
        {unread > 0 && <Button variant="ghost" onClick={() => readAll.mutate(undefined as never)}>Tout marquer comme lu</Button>}
      </div>
      {n.data.length === 0 ? <Panel><Empty title="Aucune alerte">Les alertes apparaissent ici : budgets proches de leur limite, échéances, tâches en retard. Elles restent dans l'application (pas de notification push).</Empty></Panel> : (
        <ul className="flex flex-col gap-3">
          {n.data.map((a) => (
            <li key={a.id}>
              <Panel className={a.readAt ? "opacity-70" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><LevelBadge level={a.level} />{!a.readAt && <Pill tone="accent">Nouveau</Pill>}</div>
                    <p className="mt-1.5 text-[15px] font-semibold">{a.title}</p>
                    <p className="text-sm text-muted">{a.body}</p>
                    <div className="mt-2 flex items-center gap-4 text-sm font-semibold">
                      {a.link && <Link to={a.link} onClick={() => !a.readAt && act.mutate({ id: a.id, action: "read" })} className="text-accent">Voir</Link>}
                      {!a.readAt && <button type="button" onClick={() => act.mutate({ id: a.id, action: "read" })} className="text-muted">Marquer comme lu</button>}
                    </div>
                  </div>
                  <button type="button" aria-label="Ignorer cette alerte" onClick={() => act.mutate({ id: a.id, action: "dismiss" })} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-raised"><X size={18} /></button>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Proposal({ p, onApplied }: { p: AiProposalDTO; onApplied: () => void }) {
  const [state, setState] = useState<"idle" | "done" | "ignored">("idle");
  const apply = useAction(() => post("/tasks", { title: p.title, dueDate: p.dueDate, dueTime: p.dueTime, priority: p.priority, estimatedMinutes: p.estimatedMinutes }), { keys: ["tasks", "overview", "ai-reco"], success: "Tâche créée", onDone: () => { setState("done"); onApplied(); } });
  return (
    <div className="rounded-2xl bg-surface p-3">
      <p className="text-[15px] font-semibold">{p.title}</p>
      <p className="text-xs text-muted">{p.dueDate ? dayFR(p.dueDate) : "Sans date"}{p.dueTime ? ` à ${p.dueTime}` : ""} · {priorityLabel(p.priority)}{p.estimatedMinutes ? ` · ${p.estimatedMinutes} min` : ""}</p>
      {p.reason && <p className="mt-1 text-xs text-faint">{p.reason}</p>}
      {state === "idle" ? (
        <div className="mt-2 flex gap-2"><Button onClick={() => apply.mutate(undefined as never)} loading={apply.isPending}><Check size={16} aria-hidden /> Créer la tâche</Button><Button variant="ghost" onClick={() => setState("ignored")}>Ignorer</Button></div>
      ) : <p className="mt-2 text-xs font-semibold text-save">{state === "done" ? "Tâche créée" : "Ignorée"}</p>}
    </div>
  );
}

function Chat() {
  const status = useAiStatus();
  const messages = useAiMessages();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clear, setClear] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const send = useAction((m: string) => post<AiMessageDTO[]>("/ai/chat", { message: m }), { keys: ["ai-messages"], onDone: () => { setText(""); setPending(null); } });
  const wipe = useAction(() => del("/ai/messages"), { keys: ["ai-messages"], success: "Conversation supprimée", onDone: () => setClear(false) });
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.data?.length, pending]);

  if (status.isError) return <ErrorState message={errorMessage(status.error)} onRetry={() => status.refetch()} />;
  if (!status.data) return <Skeleton className="h-64 rounded-[26px]" />;

  if (!status.data.configured) {
    return (
      <Panel>
        <h2 className="text-[17px] font-semibold">L'assistant conversationnel n'est pas activé</h2>
        <p className="mt-2 text-sm text-muted">Aucune réponse n'est simulée. Pour l'activer, l'administrateur de l'application configure un fournisseur d'IA côté serveur (la clé n'est jamais envoyée au navigateur) :</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-raised p-3 text-xs">{`AI_PROVIDER=anthropic | openai | openai-compatible\nAI_MODEL=<nom du modèle>\nAI_API_KEY=<secret Cloudflare>\nAI_BASE_URL=<https://… (openai-compatible)>`}</pre>
        <p className="mt-3 text-sm text-muted">En attendant, l'onglet « Conseils » et les alertes fonctionnent sans IA.</p>
      </Panel>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m || send.isPending) return;
    setError(null);
    setPending(m);
    send.mutate(m, { onError: (err) => { setError(errorMessage(err)); setPending(null); } });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-xs text-faint">Fournisseur : {status.data.provider} · {status.data.model}. Seuls des totaux agrégés lui sont envoyés (ni e-mail, ni libellés de revenus). Il ne modifie rien sans votre accord.</p>
      <Panel className="flex min-h-64 flex-col gap-3">
        {!messages.data ? <Skeleton className="h-32" /> : messages.data.length === 0 && !pending ? (
          <Empty title="Posez une question">Par exemple : « Où part mon argent ce mois-ci ? » ou « Aide-moi à planifier ma semaine ».</Empty>
        ) : (
          <>
            {messages.data.map((m) => (
              <div key={m.id} className={`flex flex-col gap-2 ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] ${m.role === "user" ? "bg-accent text-accent-ink" : "bg-raised"}`}>{m.content}</div>
                {m.proposals && m.proposals.length > 0 && <div className="flex w-full max-w-[92%] flex-col gap-2 rounded-2xl bg-raised/60 p-2"><p className="px-1 text-xs font-semibold text-muted">Propositions (rien n'est créé sans votre accord)</p>{m.proposals.map((p, i) => <Proposal key={i} p={p} onApplied={() => qc.invalidateQueries({ queryKey: ["tasks"] })} />)}</div>}
              </div>
            ))}
            {pending && <><div className="ml-auto max-w-[88%] rounded-2xl bg-accent px-4 py-2.5 text-[15px] text-accent-ink">{pending}</div><p className="text-sm text-faint" aria-live="polite">Réflexion en cours…</p></>}
          </>
        )}
        <div ref={end} />
      </Panel>
      {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      <form onSubmit={submit} className="flex gap-2">
        <TextInput aria-label="Votre message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre question…" maxLength={2000} />
        <Button type="submit" aria-label="Envoyer" loading={send.isPending} disabled={!text.trim()} className="shrink-0"><Send size={18} aria-hidden /></Button>
      </form>
      {messages.data && messages.data.length > 0 && <button type="button" onClick={() => setClear(true)} className="inline-flex items-center gap-1.5 self-start px-1 text-sm text-muted hover:text-danger"><Trash2 size={14} aria-hidden /> Supprimer la conversation</button>}
      <ConfirmSheet open={clear} onClose={() => setClear(false)} title="Supprimer la conversation ?" message="Tous les messages échangés avec l'assistant seront effacés." confirmLabel="Supprimer" loading={wipe.isPending} onConfirm={() => wipe.mutate(undefined as never)} />
    </div>
  );
}

export default function Assistant() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("onglet");
  const tab: Tab = TABS.some((t) => t.value === raw) ? (raw as Tab) : "reco";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Assistant" />
      <Tabs label="Assistant" value={tab} onChange={(t) => setParams({ onglet: t }, { replace: true })} tabs={[...TABS]} />
      {tab === "reco" && <Recommendations />}
      {tab === "alertes" && <Alerts />}
      {tab === "chat" && <Chat />}
    </div>
  );
}
