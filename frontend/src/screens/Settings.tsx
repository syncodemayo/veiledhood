import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Panel, ToggleRow, DRow, Btn, Addr } from "../components/primitives/primitives";
import { IcEye, IcShield, IcWallet } from "../components/icons/Icons";
import { usePrivacy } from "../context/PrivacyContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import type { AiConfigResponse, WalletContextFull } from "../types/api";

export function Settings() {
  const { visible, toggle } = usePrivacy();
  const { address, disconnect } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const aiConfig = useQuery({ queryKey: ["ai-config"], queryFn: () => api.get<AiConfigResponse>("/ai/config") });
  const ctx = useQuery({ queryKey: ["context-full"], queryFn: () => api.post<WalletContextFull>("/context/full", {}) });

  return (
    <div className="wrap-n">
      <Panel title="Interface">
        <ToggleRow icon={<IcEye size={16} />} title="Show values by default" desc="Toggle off to mask balances until revealed" on={visible} onChange={toggle} />
      </Panel>
      <Panel title="Privacy posture" kicker="Live, read-only">
        <DRow k="Tor for AI calls" v={aiConfig.data ? (aiConfig.data.torEnabled ? "Enabled" : "Disabled") : "—"} />
        <DRow k="RPC decoy ratio" v={ctx.data ? `${(ctx.data.privacy.decoyRatio * 100).toFixed(0)}%` : "—"} hint="Extra decoy queries mixed into public RPC reads for k-anonymity" />
        <DRow k="RPC batch window" v={ctx.data ? `${ctx.data.privacy.batchWindowMs}ms` : "—"} />
      </Panel>
      <Panel title="Wallet">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span className="lico">
            <IcWallet size={16} />
          </span>
          {address && <Addr a={address} onCopy={() => { navigator.clipboard.writeText(address); toast("Address copied"); }} />}
        </div>
        <DRow k="Network" v="Robinhood Chain" />
        <DRow k="Chain ID" v="4663" />
        <div style={{ marginTop: 14 }}>
          <Btn
            kind="sec"
            block
            icon={<IcShield size={14} />}
            onClick={() => {
              disconnect();
              navigate("/onboarding");
            }}
          >
            Disconnect
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
