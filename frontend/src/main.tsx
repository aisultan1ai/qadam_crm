import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider, notifyError } from "./components/Toast";
import { extractApiError, isShownGlobally } from "./api/client";
import { ConfirmProvider } from "./components/Confirm";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

initAnalytics();

// staleTime 30s — уменьшает refetch при WS-инвалидациях в hot-paths (мессенджер).
// gcTime 5min — ограничивает рост in-memory cache: неактивные query автоматически
// удаляются, предотвращая memory-leak в long-running сессиях (8+ часов).
const queryClient = new QueryClient({
  // Страховка от «тихих» ошибок: если у мутации/запроса нет своего onError, пользователь всё равно
  // увидит понятное сообщение, а не «ничего не произошло».
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError || mutation.meta?.silent || isShownGlobally(error)) return;
      notifyError("Не удалось выполнить действие", extractApiError(error).message);
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Только если данные не удалось загрузить совсем; фоновые обновления и 404 не шумят.
      if (query.state.data !== undefined || query.meta?.silent || isShownGlobally(error)) return;
      if ((error as { response?: { status?: number } })?.response?.status === 404) return;
      notifyError("Не удалось загрузить данные", extractApiError(error).message);
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

// Необработанные ошибки в промисах (например, api.post без try/catch в обработчике клика).
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  if (reason && (reason as { isAxiosError?: boolean }).isAxiosError) {
    e.preventDefault();
    if (!isShownGlobally(reason)) notifyError("Не удалось выполнить действие", extractApiError(reason).message);
    return;
  }
  console.error("[unhandledrejection]", reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
