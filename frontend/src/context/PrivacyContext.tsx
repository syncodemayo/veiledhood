import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface PrivacyState {
  visible: boolean;
  toggle: () => void;
}

const PrivacyContext = createContext<PrivacyState | null>(null);
const KEY = "vh.valuesVisible";

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(() => localStorage.getItem(KEY) !== "0");
  const value = useMemo<PrivacyState>(
    () => ({
      visible,
      toggle: () =>
        setVisible((v) => {
          const next = !v;
          localStorage.setItem(KEY, next ? "1" : "0");
          return next;
        }),
    }),
    [visible],
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyState {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within PrivacyProvider");
  return ctx;
}

export function Mask({ show, children }: { show: boolean; children: React.ReactNode }) {
  return show ? <>{children}</> : <span style={{ letterSpacing: ".08em" }}>••••••</span>;
}
