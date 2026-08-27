import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Toast } from "../components/primitives/primitives";

interface ToastState {
  toast: (title: string, desc?: string, tone?: "pos" | "neg") => void;
}

const ToastContext = createContext<ToastState | null>(null);

interface ToastEntry {
  id: number;
  title: string;
  desc?: string;
  tone: "pos" | "neg";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<ToastEntry | null>(null);

  const toast = useCallback((title: string, desc?: string, tone: "pos" | "neg" = "pos") => {
    setEntry({ id: Date.now(), title, desc, tone });
  }, []);

  const value = useMemo<ToastState>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {entry && (
        <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 200 }}>
          <Toast key={entry.id} title={entry.title} desc={entry.desc} tone={entry.tone} onDone={() => setEntry(null)} />
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
