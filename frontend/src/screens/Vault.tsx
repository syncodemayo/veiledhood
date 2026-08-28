import { useEffect, useState } from "react";
import { parseUnits, formatUnits, zeroAddress, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useWriteContract, useReadContract } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, Tabs, AssetInput, DRow, Btn, Pill, fmt } from "../components/primitives/primitives";
import { useConfirm, type StepReporter } from "../context/ConfirmContext";
import { api } from "../lib/api";
import { VEILEDHOOD_ABI } from "../lib/veiledhoodAbi";
import { ERC20_ABI } from "../lib/erc20Abi";
import { VAULT_ASSETS, getVaultAsset, type VaultAssetId } from "../config/vaultAssets";
import type { UserMeResponse, WithdrawSignatureResponse } from "../types/api";

// Set after the Part 2 mainnet deploy — no testnet fallback, since pointing at
// the old testnet vault would silently write to the wrong contract.
const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS as Address | undefined;

export function Vault() {
  const [assetId, setAssetId] = useState<VaultAssetId>("eth");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amt, setAmt] = useState("");
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { confirm } = useConfirm();
  const qc = useQueryClient();
  const asset = getVaultAsset(assetId);
  const tokenAddress = asset.tokenAddress as Address | undefined;

  useEffect(() => setAmt(""), [assetId, mode]);

  const nativeBalance = useBalance({ address, query: { enabled: Boolean(address && !tokenAddress) } });
  const erc20Balance = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && tokenAddress) },
  });
  const rawBalance = tokenAddress ? (erc20Balance.data as bigint | undefined) : nativeBalance.data?.value;
  const formattedBalance = rawBalance != null ? formatUnits(rawBalance, asset.decimals) : null;

  const meQuery = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.get<UserMeResponse>("/user/me"),
  });
  const shieldedRaw = meQuery.data?.balances.find((b) => b.currency === asset.currencyKey)?.totalAmount ?? "0";
  const shieldedAvailable = fmt(Number(formatUnits(BigInt(shieldedRaw), asset.decimals)), 2);

  function invalidateAfterAction() {
    qc.invalidateQueries({ queryKey: ["context-full"] });
    qc.invalidateQueries({ queryKey: ["user-activity"] });
    qc.invalidateQueries({ queryKey: ["user-me"] });
    erc20Balance.refetch();
    nativeBalance.refetch();
  }

  async function doDeposit(onStep: StepReporter) {
    if (!address || !publicClient) throw new Error("Wallet not connected");
    if (!VAULT_ADDRESS) throw new Error("Vault isn't deployed on this deployment yet");
    const value = parseUnits(amt || "0", asset.decimals);
    const depositedAmt = amt;
    if (tokenAddress) {
      // Step 0 "Approving" stays active until the user has actually signed the
      // approve tx in their wallet AND it's confirmed on-chain — not a timer.
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, VAULT_ADDRESS],
      })) as bigint;
      if (allowance < value) {
        const approveHash = await writeContractAsync({ address: tokenAddress, abi: ERC20_ABI, functionName: "approve", args: [VAULT_ADDRESS, value] });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      onStep(1); // "Building note" — approval done, about to prompt the deposit tx
      const hash = await writeContractAsync({ address: VAULT_ADDRESS, abi: VEILEDHOOD_ABI, functionName: "deposit", args: [tokenAddress, value] });
      onStep(2); // "Committing to Merkle tree" — deposit tx signed and submitted, awaiting confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      invalidateAfterAction();
      setAmt("");
      return { txHash: receipt.transactionHash, summary: `Deposited ${depositedAmt} ${asset.symbol} — shielding takes effect once indexed.` };
    }
    const hash = await writeContractAsync({ address: VAULT_ADDRESS, abi: VEILEDHOOD_ABI, functionName: "deposit", args: [zeroAddress, value], value });
    onStep(1); // "Committing to Merkle tree" — deposit tx signed and submitted, awaiting confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    invalidateAfterAction();
    setAmt("");
    return { txHash: receipt.transactionHash, summary: `Deposited ${depositedAmt} ${asset.symbol} — shielding takes effect once indexed.` };
  }

  async function doWithdraw(onStep: StepReporter) {
    if (!address || !publicClient) throw new Error("Wallet not connected");
    if (!VAULT_ADDRESS) throw new Error("Vault isn't deployed on this deployment yet");
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
    const tokenParam = tokenAddress ?? zeroAddress;
    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: VEILEDHOOD_ABI,
      functionName: "withdraw",
      args: [address, tokenParam, BigInt(bal.totalAmount), sig.proof as `0x${string}`[], BigInt(sig.deadline), sig.signature as `0x${string}`],
    });
    onStep(2); // "Releasing funds" — tx signed and submitted, awaiting confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    await api.post("/withdraws", { txHash: receipt.transactionHash, currency: asset.currencyKey, amount: bal.totalAmount });
    invalidateAfterAction();
    setAmt("");
    return { txHash: receipt.transactionHash, summary: `Withdrew ${formatUnits(BigInt(bal.totalAmount), asset.decimals)} ${asset.symbol} — balance is now public.` };
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
        steps: tokenAddress ? ["Approving", "Building note", "Committing to Merkle tree", "Confirming"] : ["Building note", "Committing to Merkle tree", "Confirming"],
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
                token={{ sym: asset.symbol, chain: "Robinhood Chain" }}
                balance={formattedBalance ? Number(formattedBalance) : null}
                onMax={formattedBalance ? () => setAmt(formattedBalance) : undefined}
              />
              <div style={{ marginTop: 14 }}>
                <DRow k="Anonymity set" v="Grows with every deposit" />
                <DRow k="Protocol fee" v="0.00%" />
                {tokenAddress && <DRow k="Approval" v="Requested if needed" hint="ERC-20 deposits need a one-time on-chain approval before the deposit transaction." />}
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
          {!VAULT_ADDRESS && <div className="desc" style={{ color: "var(--neg)", marginBottom: 10 }}>Vault isn't deployed on this deployment yet.</div>}
          <div style={{ marginTop: 18 }}>
            <Btn
              kind="pri"
              block
              onClick={submit}
              disabled={!VAULT_ADDRESS || (mode === "deposit" ? !amt || Number(amt) <= 0 : shieldedRaw === "0")}
            >
              {mode === "deposit" ? "Deposit and shield" : "Withdraw"}
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}
