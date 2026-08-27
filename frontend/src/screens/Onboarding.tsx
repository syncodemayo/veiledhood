import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mark, IcShield, IcCheck, IcMetaMask, IcRobinhood, IcWalletConnect } from "../components/icons/Icons";
import { Btn } from "../components/primitives/primitives";
import { useAuth } from "../context/AuthContext";
import { usePrivacy } from "../context/PrivacyContext";
import { useToast } from "../context/ToastContext";
import { getInjectedProvider, type WalletKind } from "../lib/wallet";

const WALLETS: { id: string; name: string; sub: string; kind: WalletKind; icon: typeof IcMetaMask }[] = [
  { id: "injected", name: "Browser wallet", sub: "MetaMask or any injected EIP-1193 wallet", kind: "injected", icon: IcMetaMask },
  { id: "rh", name: "Robinhood Wallet", sub: "Uses your injected provider if it's Robinhood's", kind: "injected", icon: IcRobinhood },
  { id: "wc", name: "WalletConnect", sub: "Scan a QR code with any WalletConnect-compatible wallet", kind: "walletconnect", icon: IcWalletConnect },
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const { connect, connecting, error, address } = useAuth();
  const { visible, toggle } = usePrivacy();
  const { toast } = useToast();
  const navigate = useNavigate();
  const hasInjected = getInjectedProvider() !== null;

  useEffect(() => {
    if (error) toast("Couldn't connect", error, "neg");
  }, [error, toast]);

  async function pick(id: string, kind: WalletKind) {
    setConnectingId(id);
    if (kind === "injected") toast("Check your wallet", "Approve the connection request in your wallet extension.");
    try {
      await connect(kind);
      setStep(1);
    } catch {
      // error surfaced via useAuth().error
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div style={{ display: "flex", justifyContent: "center", color: "var(--vio-lift)", marginBottom: 18 }}>
          <Mark size={40} />
        </div>
        {step === 0 && (
          <>
            <h1 className="ob-h">Connect your wallet</h1>
            <p className="ob-p">Sign a message to authenticate. Nothing is transacted until you approve a specific action.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              {WALLETS.map((w) => {
                const unavailable = w.kind === "injected" && !hasInjected;
                return (
                  <button
                    key={w.id}
                    disabled={connecting || unavailable}
                    onClick={() => pick(w.id, w.kind)}
                    className="lrow hov"
                    style={{
                      opacity: unavailable ? 0.45 : 1,
                      cursor: unavailable ? "not-allowed" : connecting ? "not-allowed" : "pointer",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r3)",
                      width: "100%",
                      textAlign: "left",
                    }}
                    title={unavailable ? "No injected wallet extension detected in this browser" : undefined}
                  >
                    <span className="lico">
                      {connectingId === w.id && connecting ? <span className="spin" style={{ display: "block", width: 15, height: 15, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} /> : <w.icon size={19} />}
                    </span>
                    <div className="lmain">
                      <div className="lt">{w.name}</div>
                      <div className="lx">{unavailable ? "Not detected — install a browser wallet extension" : w.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="ob-h">Set your privacy default</h1>
            <p className="ob-p">Connected as {address?.slice(0, 6)}…{address?.slice(-4)}. Choose whether balances render masked by default — you can change this anytime.</p>
            <div className="tgrow" style={{ marginTop: 20, padding: "15px 16px", border: "1px solid var(--line)", borderRadius: "var(--r3)" }}>
              <span className="lico" style={{ width: 32, height: 32 }}>
                <IcShield size={16} />
              </span>
              <div style={{ flex: 1 }}>
                <div className="tt">Show values by default</div>
                <div className="tx">Toggle off to mask balances until you reveal them</div>
              </div>
              <button className={visible ? "tg on focus-ring" : "tg focus-ring"} onClick={toggle} role="switch" aria-checked={visible}>
                <i />
              </button>
            </div>
            <div style={{ marginTop: 22 }}>
              <Btn kind="pri" block icon={<IcCheck size={16} />} onClick={() => navigate("/app/portfolio")}>
                Enter Veiledhood
              </Btn>
            </div>
          </>
        )}
        <div className="ob-dots">
          <span className={step === 0 ? "dot on" : "dot"} />
          <span className={step === 1 ? "dot on" : "dot"} />
        </div>
      </div>
    </div>
  );
}
