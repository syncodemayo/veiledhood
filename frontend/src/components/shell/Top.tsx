import { useState } from "react";
import { TITLES, type RouteId } from "./navConfig";
import { IcMenu, IcEye, IcEyeOff, IcAlert } from "../icons/Icons";
import { cx } from "../primitives/primitives";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ROBINHOOD_TESTNET_CHAIN_ID } from "../../lib/wallet";
import { errorMessage } from "../../lib/errors";

export function Top({ route, onMenu, visible, toggleVisible }: { route: RouteId; onMenu: () => void; visible: boolean; toggleVisible: () => void }) {
  const [t, x] = TITLES[route] ?? ["", ""];
  const { chainId, switchToRobinhoodTestnet } = useAuth();
  const { toast } = useToast();
  const [switching, setSwitching] = useState(false);
  const wrongChain = chainId !== null && chainId !== ROBINHOOD_TESTNET_CHAIN_ID;

  async function handleSwitch() {
    setSwitching(true);
    try {
      await switchToRobinhoodTestnet();
    } catch (e) {
      toast("Couldn't switch network", errorMessage(e, "Try switching manually in your wallet."), "neg");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <header className="top">
      <button className="btn btn-icon mtop focus-ring" onClick={onMenu} aria-label="Menu">
        <IcMenu size={19} />
      </button>
      <div className="tl">
        <div className="tt">{t}</div>
        <div className="tx">{x}</div>
      </div>
      <div className="tr">
        <button
          className={cx("netchip focus-ring")}
          role="switch"
          aria-checked={visible}
          onClick={toggleVisible}
          title="Toggle privacy mode"
          style={visible ? { borderColor: "var(--vio-line)", background: "var(--vio-dim)", color: "var(--vio-lift)" } : undefined}
        >
          {visible ? <IcEye size={14} /> : <IcEyeOff size={14} />}
          <span className="nl">{visible ? "Values shown" : "Values hidden"}</span>
        </button>
        {wrongChain ? (
          <button
            className="netchip focus-ring"
            onClick={handleSwitch}
            disabled={switching}
            style={{ borderColor: "var(--warn)", background: "var(--warn-dim)", color: "var(--warn)", cursor: switching ? "wait" : "pointer" }}
          >
            <IcAlert size={14} />
            <span className="nl">{switching ? "Switching…" : "Wrong network — switch"}</span>
          </button>
        ) : (
          <span className="netchip">
            <span className="nd pulse-dot" />
            <span className="nl">Robinhood Testnet Chain</span>
          </span>
        )}
      </div>
    </header>
  );
}
