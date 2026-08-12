import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ToastMsg { id: number; title: string; body?: string }
const Ctx = createContext<{ push: (title: string, body?: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const push = useCallback((title: string, body?: string) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto rounded-xl border border-bronze/30 bg-surface p-4 shadow-card">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span className="rounded-full bg-bronze/10 px-1.5 py-px font-mono text-[10px] font-medium text-bronze">agent</span>
              {t.title}
            </p>
            {t.body && <p className="mt-1 text-sm text-faint">{t.body}</p>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside ToastProvider");
  return c;
}
