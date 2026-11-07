import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/queries";
import { useApplyTheme } from "./lib/theme";
import { AppShell } from "./components/Shell";
import { Button } from "./components/ui";
import Overview from "./pages/Overview";
import { ForgotPassword, Login, Register } from "./pages/Auth";

const ExpenseForm = lazy(() => import("./pages/ExpenseForm"));
const Finance = lazy(() => import("./pages/Finance"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Assistant = lazy(() => import("./pages/Assistant"));
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  const me = useMe();
  useApplyTheme(me.data?.settings.theme);

  if (me.isPending) return <div className="min-h-dvh bg-canvas" aria-busy="true" />;

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
      <Route path="/depense/nouvelle" element={<Suspense fallback={null}><ExpenseForm /></Suspense>} />
      <Route path="/depense/:id" element={<Suspense fallback={null}><ExpenseForm /></Suspense>} />
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="/finances" element={<Finance />} />
        <Route path="/analyses" element={<Analytics />} />
        <Route path="/taches" element={<Tasks />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/parametres" element={<Settings />} />
        {/* Anciennes adresses de la V1 */}
        <Route path="/historique" element={<Navigate to="/finances?tab=transactions" replace />} />
        <Route path="/analyse" element={<Navigate to="/analyses" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
