import { NavLink, useNavigate } from "react-router-dom";
import { BarChart3, CalendarDays, Home, Plus, Settings } from "lucide-react";

const items = [
  { to: "/", label: "Accueil", Icon: Home, end: true },
  { to: "/analyse", label: "Analyse", Icon: BarChart3 },
  null,
  { to: "/historique", label: "Historique", Icon: CalendarDays },
  { to: "/parametres", label: "Paramètres", Icon: Settings },
] as const;

export function BottomNav() {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/85 backdrop-blur-xl pb-safe lg:bottom-4 lg:mx-auto lg:max-w-md lg:rounded-[28px] lg:border lg:pb-0 lg:shadow-xl lg:shadow-black/5"
    >
      <ul className="mx-auto flex h-[68px] max-w-lg items-center justify-around px-2">
        {items.map((item) =>
          item === null ? (
            <li key="add">
              <button
                type="button"
                onClick={() => navigate("/depense/nouvelle")}
                aria-label="Ajouter une dépense"
                className="-mt-7 grid size-[60px] place-items-center rounded-full bg-accent text-accent-ink shadow-lg shadow-accent/30 transition active:scale-95"
              >
                <Plus size={30} strokeWidth={2.4} />
              </button>
            </li>
          ) : (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={"end" in item ? item.end : false}
                className={({ isActive }) =>
                  `flex w-[68px] flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${
                    isActive ? "text-accent" : "text-faint hover:text-ink"
                  }`
                }
              >
                <item.Icon size={23} aria-hidden />
                {item.label}
              </NavLink>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
