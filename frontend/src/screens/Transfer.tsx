import { useEffect, useState } from "react";
import { parseUnits, formatUnits } from "ethers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, Tabs, AssetInput, DRow, Btn } from "../components/primitives/primitives";
import { IcShield } from "../components/icons/Icons";
import { useConfirm, type StepReporter } from "../context/ConfirmContext";
import { api } from "../lib/api";
import { VAULT_ASSETS, getVaultAsset, type VaultAssetId } from "../config/vaultAssets";
import type { TransferFeeQuote, TransferResponse, UserMeResponse } from "../types/api";

export function Transfer() {
  const [assetId, setAssetId] = useState<VaultAssetId>("eth");
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState("");
  const { confirm } = useConfirm();
  const qc = useQueryClient();
  const asset = getVaultAsset(assetId);

  useEffect(() => setAmt(""), [assetId]);

  const meQuery = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.get<UserMeResponse>("/user/me"),
  });
  const shieldedBalance = meQuery.data?.balances.find((b) => b.currency === asset.currencyKey)?.totalAmount ?? "0";

  const amountRaw = amt && Number(amt) > 0 ? parseUnits(amt, asset.decimals).toString() : null;
  const feeQuery = useQuery({
    queryKey: ["transfer-fee-quote", asset.currencyKey, amountRaw],
    queryFn: () => api.get<TransferFeeQuote>(`/transfers/fee-quote?amount=${amountRaw}&currency=${encodeURIComponent(asset.currencyKey)}`),
    enabled: Boolean(amountRaw),
  });

  const validRecipient = /^0x[a-fA-F0-9]{40}$/.test(to);

  async function doTransfer(onStep: StepReporter) {
    const idempotencyKey = crypto.randomUUID();
    onStep(1); // "Settling Merkle payout" — request in flight (single atomic backend call, no wallet signing)
    const result = await api.post<TransferResponse>("/transfers", {
      idempotencyKey,
      currency: asset.currencyKey,
      amount: amountRaw,
      to,
    });
    qc.invalidateQueries({ queryKey: ["context-full"] });
    qc.invalidateQueries({ queryKey: ["user-activity"] });
    qc.invalidateQueries({ queryKey: ["user-me"] });
    const sentAmt = amt;
    const sentTo = to;
    setAmt("");
    setTo("");
    return {
      txHash: result.chain?.adminWithdrawTxHash,
      summary: `Sent ${sentAmt} ${asset.symbol} to ${sentTo.slice(0, 6)}…${sentTo.slice(-4)} — settled off-chain, no public trail.`,
    };
  }

  function submit() {
    confirm({
      title: "Confirm shielded transfer",
      rows: [
        ["Sending", `${amt} ${asset.symbol}`],
        ["To", `${to.slice(0, 6)}…${to.slice(-4)}`],
        ["Recipient receives", feeQuery.data ? `${formatUnits(feeQuery.data.recipientReceives, asset.decimals)} ${asset.symbol}` : "—"],
        ["Fee", feeQuery.data ? `${formatUnits(feeQuery.data.fees.total, asset.decimals)} ${asset.symbol}` : "—"],
        ["You pay", feeQuery.data ? `${formatUnits(feeQuery.data.senderTotalDebit, asset.decimals)} ${asset.symbol}` : "—"],
      ],
      cta: "Send privately",
      steps: ["Debiting shielded balance", "Settling Merkle payout", "Confirming"],
      action: doTransfer,
    });
  }

  const canSubmit = Boolean(amountRaw) && validRecipient && shieldedBalance !== "0" && BigInt(feeQuery.data?.senderTotalDebit ?? "0") <= BigInt(shieldedBalance || "0");

  return (
    <div className="wrap-n">
      <Panel title="Transfer">
        <Tabs items={VAULT_ASSETS.map((a) => ({ id: a.id, label: a.symbol }))} active={assetId} onChange={(v) => setAssetId(v as VaultAssetId)} />
        <div style={{ marginTop: 14 }}>
          <p className="desc" style={{ marginBottom: 14 }}>
            Sends from your shielded balance directly to another address. Settled off-chain against the Merkle ledger — no public on-chain trail for this transfer.
          </p>
          <div className="pbar" style={{ marginBottom: 14 }}>
            <IcShield size={15} />
            <span className="pt">Transfers spend from your shielded balance only — deposit into the Vault first if you haven't already.</span>
          </div>
          <AssetInput
            label="Amount"
            value={amt}
            onChange={setAmt}
            token={{ sym: asset.symbol, chain: "Robinhood Chain" }}
            balance={Number(formatUnits(shieldedBalance, asset.decimals))}
            onMax={() => setAmt(formatUnits(shieldedBalance, asset.decimals))}
          />
          <div className="ai" style={{ marginTop: 12 }}>
            <div className="ai-top">
              <span className="lbl">Recipient address</span>
            </div>
            <div className="ai-row">
              <input
                className="ai-in"
                style={{ fontSize: 14, fontFamily: "var(--mono)" }}
                placeholder="0x…"
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
              />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <DRow k="Recipient receives" v={feeQuery.data ? `${formatUnits(feeQuery.data.recipientReceives, asset.decimals)} ${asset.symbol}` : "—"} />
            <DRow k="Fee" v={feeQuery.data ? `${formatUnits(feeQuery.data.fees.total, asset.decimals)} ${asset.symbol}` : "—"} />
            <DRow k="You pay" v={feeQuery.data ? `${formatUnits(feeQuery.data.senderTotalDebit, asset.decimals)} ${asset.symbol}` : "—"} />
          </div>
          <div style={{ marginTop: 18 }}>
            <Btn kind="pri" block onClick={submit} disabled={!canSubmit}>
              Send privately
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}
