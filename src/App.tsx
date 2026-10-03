import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useMe } from "./lib/queries";
import { useApplyTheme } from "./lib/theme";
import { BottomNav } from "./components/BottomNav";
import { Button, Skeleton } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import { ForgotPassword, Login, Register } from "./pages/Auth";

const ExpenseWizard = lazy(() => import("./pages/ExpenseWizard"));
const History = lazy(() => import("./pages/History"));
const Analysis = lazy(() => import("./pages/Analysis"));
const Settings = lazy(() => import("./pages/Settings"));

function PageFallback() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Skeleton className="mx-auto h-8 w-40" />
      <Skeleton className="h-64 rounded-[26px]" />
    </div>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-surface focus:p-3">
        Aller au contenu
      </a>
      <main id="contenu" key={pathname} className="anim-fade mx-auto max-w-lg px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+112px)] lg:max-w-5xl">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </>
  );
}

export default function App() {
  const me = useMe();
  useApplyTheme(me.data?.settings.theme);

  if (me.isPending) {
    return <div className="min-h-dvh bg-canvas" aria-busy="true" />;
  }

  if (me.isError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-[15px] text-muted">Impossible de joindre O-Budget. Vérifiez votre connexion.</p>
        <Button onClick={() => me.refetch()}>Réessayer</Button>
      </main>
    );
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="/inscription" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/depense/nouvelle"
        element={
          <Suspense fallback={null}>
            <ExpenseWizard />
          </Suspense>
        }
      />
      <Route
        path="/depense/:id"
        element={
          <Suspense fallback={null}>
            <ExpenseWizard />
          </Suspense>
        }
      />
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="/analyse" element={<Analysis />} />
        <Route path="/historique" element={<History />} />
        <Route path="/parametres" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
