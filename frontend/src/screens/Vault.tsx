import { useEffect, useState } from "react";
import { Contract, parseUnits, formatUnits, ZeroAddress } from "ethers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, Tabs, AssetInput, DRow, Btn, Pill, fmt } from "../components/primitives/primitives";
import { useAuth } from "../context/AuthContext";
import { useConfirm, type StepReporter } from "../context/ConfirmContext";
import { api } from "../lib/api";
import { VEILEDHOOD_ABI } from "../lib/veiledhoodAbi";
import { ERC20_ABI } from "../lib/erc20Abi";
import { VAULT_ASSETS, getVaultAsset, type VaultAssetId } from "../config/vaultAssets";
import type { UserMeResponse, WithdrawSignatureResponse } from "../types/api";

const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS ?? "0x97B2009b4F734E0b1F6c8E159B5E491C22E3E1Bc";

export function Vault() {
  const [assetId, setAssetId] = useState<VaultAssetId>("eth");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amt, setAmt] = useState("");
  const { provider, address } = useAuth();
  const { confirm } = useConfirm();
  const qc = useQueryClient();
  const asset = getVaultAsset(assetId);

  useEffect(() => setAmt(""), [assetId, mode]);

  const balanceQuery = useQuery({
    queryKey: ["wallet-balance", assetId, address],
    queryFn: async () => {
      if (!provider || !address) return "0";
      if (!asset.tokenAddress) {
        const raw = await provider.getBalance(address);
        return formatUnits(raw, asset.decimals);
      }
      const erc20 = new Contract(asset.tokenAddress, ERC20_ABI, provider);
      const raw = await erc20.balanceOf(address);
      return formatUnits(raw, asset.decimals);
    },
    enabled: Boolean(provider && address),
  });

  const meQuery = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.get<UserMeResponse>("/user/me"),
  });
  const shieldedRaw = meQuery.data?.balances.find((b) => b.currency === asset.currencyKey)?.totalAmount ?? "0";
  const shieldedAvailable = fmt(Number(formatUnits(shieldedRaw, asset.decimals)), 2);

  function invalidateAfterAction() {
    qc.invalidateQueries({ queryKey: ["context-full"] });
    qc.invalidateQueries({ queryKey: ["user-activity"] });
    qc.invalidateQueries({ queryKey: ["wallet-balance", assetId, address] });
    qc.invalidateQueries({ queryKey: ["user-me"] });
  }

  async function doDeposit(onStep: StepReporter) {
    if (!provider) throw new Error("Wallet not connected");
    const signer = await provider.getSigner();
    const vault = new Contract(VAULT_ADDRESS, VEILEDHOOD_ABI, signer);
    const value = parseUnits(amt || "0", asset.decimals);
    const depositedAmt = amt;
    if (asset.tokenAddress) {
      // Step 0 "Approving" stays active until the user has actually signed the
      // approve tx in their wallet AND it's confirmed on-chain — not a timer.
      const erc20 = new Contract(asset.tokenAddress, ERC20_ABI, signer);
      const allowance: bigint = await erc20.allowance(address, VAULT_ADDRESS);
      if (allowance < value) {
        const approveTx = await erc20.approve(VAULT_ADDRESS, value);
        await approveTx.wait();
      }
      onStep(1); // "Building note" — approval done, about to prompt the deposit tx
      const tx = await vault.deposit(asset.tokenAddress, value);
      onStep(2); // "Committing to Merkle tree" — deposit tx signed and submitted, awaiting confirmation
      const receipt = await tx.wait();
      invalidateAfterAction();
      setAmt("");
      return { txHash: receipt?.hash as string, summary: `Deposited ${depositedAmt} ${asset.symbol} — shielding takes effect once indexed.` };
    }
    const tx = await vault.deposit(ZeroAddress, value, { value });
    onStep(1); // "Committing to Merkle tree" — deposit tx signed and submitted, awaiting confirmation
    const receipt = await tx.wait();
    invalidateAfterAction();
    setAmt("");
    return { txHash: receipt?.hash as string, summary: `Deposited ${depositedAmt} ${asset.symbol} — shielding takes effect once indexed.` };
  }

  async function doWithdraw(onStep: StepReporter) {
    if (!provider || !address) throw new Error("Wallet not connected");
    const me = await api.get<UserMeResponse>("/user/me");
    const bal = me.balances.find((b) => b.currency === asset.currencyKey);
    if (!bal || bal.totalAmount === "0") throw new Error(`No shielded ${asset.symbol} balance to withdraw`);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const sig = await api.post<WithdrawSignatureResponse>("/user/withdraw-signature", {
      amount: bal.totalAmount,
      deadline,
      currency: asset.currencyKey,
    });
    onStep(1); // "Spending nullifier" — proof generated, about to prompt the withdraw tx
    const signer = await provider.getSigner();
    const vault = new Contract(VAULT_ADDRESS, VEILEDHOOD_ABI, signer);
    const tokenParam = asset.tokenAddress ?? ZeroAddress;
    const tx = await vault.withdraw(address, tokenParam, BigInt(bal.totalAmount), sig.proof, sig.deadline, sig.signature);
    onStep(2); // "Releasing funds" — tx signed and submitted, awaiting confirmation
    const receipt = await tx.wait();
    await api.post("/withdraws", { txHash: receipt?.hash, currency: asset.currencyKey, amount: bal.totalAmount });
    invalidateAfterAction();
    setAmt("");
    return { txHash: receipt?.hash as string, summary: `Withdrew ${formatUnits(bal.totalAmount, asset.decimals)} ${asset.symbol} — balance is now public.` };
  }

  function submit() {
    if (mode === "deposit") {
      confirm({
        title: "Confirm deposit",
        rows: [
          ["Depositing", `${amt || "0"} ${asset.symbol}`],
          ["You get", `${amt || "0"} v${asset.symbol}`],
          ["Anonymity set", "Grows with every deposit"],
          ["Protocol fee", "0.00%"],
        ],
        cta: "Deposit and shield",
        steps: asset.tokenAddress ? ["Approving", "Building note", "Committing to Merkle tree", "Confirming"] : ["Building note", "Committing to Merkle tree", "Confirming"],
        action: doDeposit,
      });
    } else {
      confirm({
        title: "Confirm withdrawal",
        rows: [
          ["Withdrawing", `Full shielded ${asset.symbol} balance`],
          ["Reveals", "Amount only"],
          ["Protocol fee", "0.00%"],
        ],
        cta: "Withdraw",
        steps: ["Generating proof", "Spending nullifier", "Releasing funds"],
        action: doWithdraw,
      });
    }
  }

  return (
    <div className="wrap-n">
      <Panel action={<Tabs items={[{ id: "deposit", label: "Deposit" }, { id: "withdraw", label: "Withdraw" }]} active={mode} onChange={(v) => setMode(v as "deposit" | "withdraw")} />} title="Vault">
        <Tabs
          items={VAULT_ASSETS.map((a) => ({ id: a.id, label: `${a.symbol} vault` }))}
          active={assetId}
          onChange={(v) => setAssetId(v as VaultAssetId)}
        />
        <div style={{ marginTop: 14 }}>
          {mode === "deposit" ? (
            <>
              <p className="desc" style={{ marginBottom: 14 }}>
                Depositing moves {asset.symbol} into the shielded Merkle-based vault. Your balance stops being publicly attributable to your address.
              </p>
              <AssetInput
                label="Amount"
                value={amt}
                onChange={setAmt}
                token={{ sym: asset.symbol, chain: "Robinhood Testnet Chain" }}
                balance={balanceQuery.data ? Number(balanceQuery.data) : null}
                onMax={balanceQuery.data ? () => setAmt(balanceQuery.data!) : undefined}
              />
              <div style={{ marginTop: 14 }}>
                <DRow k="Anonymity set" v="Grows with every deposit" />
                <DRow k="Protocol fee" v="0.00%" />
                {asset.tokenAddress && <DRow k="Approval" v="Requested if needed" hint="ERC-20 deposits need a one-time on-chain approval before the deposit transaction." />}
              </div>
            </>
          ) : (
            <>
              <p className="desc" style={{ marginBottom: 14 }}>
                Withdrawing spends a nullifier and reveals the withdrawn amount on-chain. Your full shielded {asset.symbol} balance is withdrawn at once.
              </p>
              <div className="ai" style={{ opacity: 0.7 }}>
                <div className="ai-top">
                  <span className="lbl">Available to withdraw</span>
                </div>
                <div className="ai-row">
                  <span className="ai-in" style={{ borderStyle: "dashed" }}>
                    {meQuery.isLoading ? "…" : shieldedAvailable}
                  </span>
                  <span className="tokbtn" style={{ cursor: "default" }}>
                    {asset.symbol}
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <DRow k="Reveals" v={<Pill tone="warn">Amount only</Pill>} />
              </div>
            </>
          )}
          <div style={{ marginTop: 18 }}>
            <Btn
              kind="pri"
              block
              onClick={submit}
              disabled={mode === "deposit" ? !amt || Number(amt) <= 0 : shieldedRaw === "0"}
            >
              {mode === "deposit" ? "Deposit and shield" : "Withdraw"}
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}
