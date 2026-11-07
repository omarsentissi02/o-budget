import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Suspense } from "react";
import { Bell, ChartNoAxesColumn, CheckSquare, Home, Plus, Receipt, ReceiptText, Settings, Sparkles, Wallet } from "lucide-react";
import { useMe, useOverview } from "../lib/queries";
import { api, errorMessage } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../hooks/Toast";
import { Sheet } from "./Sheet";
import { Button, Skeleton, TextInput } from "./ui";

const MAIN = [
  { to: "/", label: "Aperçu", Icon: Home, end: true },
  { to: "/finances", label: "Finances", Icon: Wallet },
  { to: "/analyses", label: "Analyses", Icon: ChartNoAxesColumn },
  { to: "/taches", label: "Tâches", Icon: CheckSquare },
  { to: "/assistant", label: "Assistant", Icon: Sparkles },
  { to: "/parametres", label: "Paramètres", Icon: Settings },
] as const;

function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api("/tasks/quick", { method: "POST", body: { text } });
      setText("");
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      toast("Tâche ajoutée");
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Ajouter">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" data-autofocus onClick={() => go("/depense/nouvelle")} className="flex h-24 flex-col items-start justify-between rounded-2xl bg-accent p-4 text-left font-semibold text-accent-ink">
          <ReceiptText size={22} aria-hidden /> Dépense
        </button>
        <button type="button" onClick={() => go("/finances?tab=revenus&nouveau=1")} className="flex h-24 flex-col items-start justify-between rounded-2xl bg-raised p-4 text-left font-semibold">
          <Receipt size={22} aria-hidden /> Revenu
        </button>
      </div>
      <form onSubmit={addTask} className="mt-5 flex flex-col gap-2">
        <label htmlFor="quick-task" className="text-sm font-medium text-muted">Tâche rapide</label>
        <TextInput id="quick-task" value={text} onChange={(e) => setText(e.target.value)} placeholder="Appeler la CAF demain 14h !" maxLength={200} />
        <p className="text-xs text-faint">Date (demain, lundi, 12/11), heure (14h30), priorité (!, !!) et durée (~30min) sont reconnues.</p>
        <Button type="submit" loading={busy} disabled={!text.trim()}>Ajouter la tâche</Button>
      </form>
    </Sheet>
  );
}

function Bell_() {
  const o = useOverview();
  const n = o.data?.unreadNotifications ?? 0;
  return (
    <NavLink to="/assistant?onglet=alertes" aria-label={n ? `${n} alertes non lues` : "Alertes"} className="relative grid size-11 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink">
      <Bell size={22} aria-hidden />
      {n > 0 && <span className="absolute top-1.5 right-1.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{n > 9 ? "9+" : n}</span>}
    </NavLink>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const me = useMe();
  const mobileNav = MAIN.filter((i) => ["/", "/finances", "/analyses", "/taches"].includes(i.to));
  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-surface focus:p-3">Aller au contenu</a>

      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line/70 bg-surface px-3 pt-6 pb-4 lg:flex">
        <p className="px-3 pb-5 text-xl font-semibold tracking-tight">O-Budget</p>
        <Button onClick={() => setAddOpen(true)} className="mb-4"><Plus size={18} aria-hidden /> Ajouter</Button>
        <nav aria-label="Navigation principale" className="flex flex-1 flex-col gap-1">
          {MAIN.map(({ to, label, Icon, ...r }) => (
            <NavLink key={to} to={to} end={"end" in r} className={({ isActive }) => `flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition ${isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink"}`}>
              <Icon size={20} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <p className="truncate px-3 text-xs text-faint">{me.data?.user.email}</p>
      </aside>

      {/* En-tête mobile */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-canvas/85 px-4 pt-safe backdrop-blur-xl lg:hidden">
        <span className="text-lg font-semibold tracking-tight">O-Budget</span>
        <div className="flex items-center">
          <Bell_ />
          <NavLink to="/assistant" aria-label="Assistant" className="grid size-11 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"><Sparkles size={22} aria-hidden /></NavLink>
          <NavLink to="/parametres" aria-label="Paramètres" className="grid size-11 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"><Settings size={22} aria-hidden /></NavLink>
        </div>
      </div>

      <main id="contenu" key={pathname} className="anim-fade mx-auto max-w-lg px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+112px)] lg:ml-60 lg:max-w-5xl lg:px-8 lg:pt-8 lg:pb-12 xl:mx-auto xl:pl-72">
        <Suspense fallback={<div className="flex flex-col gap-4 pt-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 rounded-[26px]" /></div>}>
          <Outlet />
        </Suspense>
      </main>

      {/* Barre du bas (mobile) */}
      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/90 backdrop-blur-xl pb-safe lg:hidden">
        <ul className="mx-auto flex h-[68px] max-w-lg items-center justify-around px-2">
          {mobileNav.slice(0, 2).map((i) => <NavItem key={i.to} {...i} />)}
          <li>
            <button type="button" onClick={() => setAddOpen(true)} aria-label="Ajouter" className="-mt-7 grid size-[60px] place-items-center rounded-full bg-accent text-accent-ink shadow-lg shadow-accent/30 transition active:scale-95">
              <Plus size={30} strokeWidth={2.4} />
            </button>
          </li>
          {mobileNav.slice(2).map((i) => <NavItem key={i.to} {...i} />)}
        </ul>
      </nav>
      <QuickAdd open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function NavItem({ to, label, Icon, ...r }: { to: string; label: string; Icon: typeof Home; end?: boolean }) {
  return (
    <li>
      <NavLink to={to} end={"end" in r} className={({ isActive }) => `flex w-[68px] flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${isActive ? "text-accent" : "text-faint hover:text-ink"}`}>
        <Icon size={23} aria-hidden /> {label}
      </NavLink>
    </li>
  );
}
