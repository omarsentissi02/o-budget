import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ApiRequestError } from "./lib/api";
import { qk } from "./lib/queries";
import { MonthProvider } from "./hooks/MonthContext";
import { ToastProvider } from "./hooks/Toast";
import "./index.css";

// Session expirée pendant l'utilisation → retour à l'écran de connexion.
const onError = (error: unknown) => {
  if (error instanceof ApiRequestError && error.status === 401) queryClient.setQueryData(qk.me, null);
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500 && error.status !== 0) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <MonthProvider>
            <App />
          </MonthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.error("[pwa] service worker", e));
  });
}
