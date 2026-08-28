import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Mark, IcShield, IcCheck } from "../components/icons/Icons";
import { Btn } from "../components/primitives/primitives";
import { useAuth } from "../context/AuthContext";
import { usePrivacy } from "../context/PrivacyContext";
import { useToast } from "../context/ToastContext";

export function Onboarding() {
  const [step, setStep] = useState(0);
  const { token, error, address, connecting } = useAuth();
  const { visible, toggle } = usePrivacy();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (error) toast("Couldn't connect", error, "neg");
  }, [error, toast]);

  useEffect(() => {
    if (token) setStep(1);
  }, [token]);

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
            <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
              <ConnectButton label="Connect wallet" showBalance={false} chainStatus="none" />
            </div>
            {connecting && <div className="desc" style={{ textAlign: "center", marginTop: 16 }}>Check your wallet — sign the message to continue.</div>}
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
