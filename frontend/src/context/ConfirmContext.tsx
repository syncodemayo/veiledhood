import { createContext, useContext, useState, type ReactNode } from "react";
import { Modal, Step, Btn, DRow, Pill } from "../components/primitives/primitives";
import { IcShield, IcCheck, IcExternal } from "../components/icons/Icons";
import { ROBINHOOD_MAINNET_EXPLORER } from "../lib/wallet";
import { errorMessage } from "../lib/errors";

/** Called by `action` right before starting the step at this index — advances the
 * stepper to reflect real progress (e.g. "wallet approval tx submitted"), never a timer. */
export type StepReporter = (index: number) => void;

export interface ConfirmPayload {
  title: string;
  rows: [string, ReactNode][];
  cta: string;
  steps: string[];
  action: (onStep: StepReporter) => Promise<{ txHash?: string; summary?: string }>;
}

interface ConfirmState {
  confirm: (payload: ConfirmPayload) => void;
}

const ConfirmContext = createContext<ConfirmState | null>(null);

type Phase = "review" | "signing" | "done" | "error";

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<ConfirmPayload | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const [stepIdx, setStepIdx] = useState(0);
  const [result, setResult] = useState<{ txHash?: string; summary?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function confirm(p: ConfirmPayload) {
    setPayload(p);
    setPhase("review");
    setStepIdx(0);
    setResult(null);
    setError(null);
  }

  async function run() {
    if (!payload) return;
    setPhase("signing");
    setStepIdx(0);
    try {
      const r = await payload.action((i) => setStepIdx(Math.min(i, payload.steps.length - 1)));
      setStepIdx(payload.steps.length - 1);
      setResult(r);
      setPhase("done");
    } catch (e) {
      setError(errorMessage(e, "Transaction failed"));
      setPhase("error");
    }
  }

  function close() {
    if (phase === "signing") return;
    setPayload(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {payload && (
        <Modal
          title={payload.title}
          icon={<IcShield size={16} />}
          onClose={phase === "signing" ? undefined : close}
          footer={
            phase === "review" ? (
              <>
                <Btn kind="sec" block onClick={close}>
                  Cancel
                </Btn>
                <Btn kind="pri" block onClick={run}>
                  {payload.cta}
                </Btn>
              </>
            ) : undefined
          }
        >
          {phase === "review" && (
            <>
              <div className="pbar" style={{ marginBottom: 14 }}>
                <IcShield size={15} />
                <span className="pt">This action is signed by your wallet. Nothing here is sent to Veiledhood in plaintext beyond what the protocol requires.</span>
              </div>
              {payload.rows.map(([k, v]) => (
                <DRow key={k} k={k} v={v} />
              ))}
            </>
          )}
          {phase === "signing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {payload.steps.map((s, i) => (
                <Step key={s} n={i + 1} title={s} desc="" state={i < stepIdx ? "done" : i === stepIdx ? "act" : ""} />
              ))}
            </div>
          )}
          {phase === "done" && (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <span className="lico" style={{ width: 44, height: 44, margin: "0 auto 14px", color: "var(--pos)", background: "var(--pos-dim)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "100px" }}>
                <IcCheck size={22} />
              </span>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Done</div>
              {result?.summary && <div style={{ color: "var(--tx3)", fontSize: 13, marginBottom: 14 }}>{result.summary}</div>}
              {result?.txHash && (
                <a
                  href={`${ROBINHOOD_MAINNET_EXPLORER}/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="pill pill-mute"
                  style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                >
                  {result.txHash.slice(0, 10)}…{result.txHash.slice(-6)}
                  <IcExternal size={12} />
                </a>
              )}
              <div style={{ marginTop: 18 }}>
                <Btn kind="pri" block onClick={close}>
                  Close
                </Btn>
              </div>
            </div>
          )}
          {phase === "error" && (
            <div>
              <Pill tone="neg">Failed</Pill>
              <div style={{ marginTop: 12, color: "var(--tx3)", fontSize: 13 }}>{error}</div>
              <div style={{ marginTop: 18 }}>
                <Btn kind="sec" block onClick={close}>
                  Close
                </Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmState {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
