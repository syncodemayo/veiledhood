import { useEffect, useState } from "react";
import { parseUnits, formatUnits, zeroAddress, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useWriteContract, useReadContract } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, Tabs, AssetInput, DRow, Btn, fmtBal } from "../components/primitives/primitives";
import { IcShield } from "../components/icons/Icons";
import { useConfirm, type StepReporter } from "../context/ConfirmContext";
import { api } from "../lib/api";
import { VEILSWAP_ABI } from "../lib/veilSwapAbi";
import { ERC20_ABI } from "../lib/erc20Abi";
import type {
  VeilswapPair,
  VeilswapQuoteResponse,
  VeilswapMeResponse,
  VeilswapDepositResponse,
  SwapStatusResponse,
} from "../types/api";

// Set after the Part 2 mainnet deploy — no testnet fallback.
const VEILSWAP_ADDRESS = import.meta.env.VITE_VEILSWAP_ADDRESS as Address | undefined;
const USDG_ADDRESS = (import.meta.env.VITE_USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") as Address;

const ASSET = {
  ETH:  { address: zeroAddress as Address, symbol: "ETH", decimals: 18 },
  USDG: { address: USDG_ADDRESS,           symbol: "USDG", decimals: 6 },
};

type Direction = "eth-usdg" | "usdg-eth";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function Swap() {
  const [dir, setDir] = useState<Direction>("eth-usdg");
  const [amt, setAmt] = useState("");
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { confirm } = useConfirm();
  const qc = useQueryClient();

  const from = dir === "eth-usdg" ? ASSET.ETH : ASSET.USDG;
  const to = dir === "eth-usdg" ? ASSET.USDG : ASSET.ETH;

  useEffect(() => setAmt(""), [dir]);

  const pairsQuery = useQuery({
    queryKey: ["veilswap-pairs"],
    queryFn: () => api.get<VeilswapPair[]>("/veilswap/pairs"),
  });
  const pair = pairsQuery.data?.find(
    (p) => p.tokenIn.toLowerCase() === from.address.toLowerCase() && p.tokenOut.toLowerCase() === to.address.toLowerCase()
  );

  const nativeBalance = useBalance({ address, query: { enabled: Boolean(address && from.address === zeroAddress) } });
  const erc20Balance = useReadContract({
    address: from.address === zeroAddress ? undefined : from.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && from.address !== zeroAddress) },
  });
  const rawWalletBalance = from.address === zeroAddress ? nativeBalance.data?.value : (erc20Balance.data as bigint | undefined);
  const formattedWalletBalance = rawWalletBalance != null ? formatUnits(rawWalletBalance, from.decimals) : null;

  const amountRaw = amt && Number(amt) > 0 ? parseUnits(amt, from.decimals) : null;

  const quoteQuery = useQuery({
    queryKey: ["veilswap-quote", from.address, to.address, amountRaw?.toString()],
    queryFn: () =>
      api.get<VeilswapQuoteResponse>(
        `/veilswap/quote?tokenIn=${from.address}&tokenOut=${to.address}&amountIn=${amountRaw}`
      ),
    enabled: Boolean(amountRaw),
  });

  const meQuery = useQuery({
    queryKey: ["veilswap-me"],
    queryFn: () => api.get<VeilswapMeResponse>("/veilswap/me"),
  });
  const vaultBalanceRaw = BigInt(
    meQuery.data?.balances.find((b) => b.tokenAddress.toLowerCase() === from.address.toLowerCase())?.totalAmount ?? "0"
  );
  const maxPayAmountRaw = vaultBalanceRaw + (rawWalletBalance ?? 0n);

  function invalidateAfterAction() {
    qc.invalidateQueries({ queryKey: ["context-full"] });
    qc.invalidateQueries({ queryKey: ["veilswap-me"] });
    erc20Balance.refetch();
    nativeBalance.refetch();
  }

  async function pollSwap(key: string, onStep: StepReporter, stepIdx: { swapExecuting: number; payingOut: number }): Promise<SwapStatusResponse> {
    let lastStatus = "";
    for (let i = 0; i < 60; i += 1) {
      const s = await api.get<SwapStatusResponse>(`/swaps/${key}`);
      if (s.status !== lastStatus) {
        lastStatus = s.status;
        if (s.status === "swap_completed") onStep(stepIdx.payingOut);
      }
      if (s.status === "payout_completed") return s;
      if (s.status === "failed") throw new Error(s.payoutError || "Swap failed");
      await sleep(1500);
    }
    throw new Error("Swap timed out waiting for confirmation");
  }

  async function doSwap(onStep: StepReporter) {
    if (!address || !publicClient) throw new Error("Wallet not connected");
    if (!VEILSWAP_ADDRESS) throw new Error("Swap isn't deployed on this deployment yet");
    if (!pair) throw new Error("Pair not supported");
    if (!amountRaw) throw new Error("Enter an amount");

    const swappedAmt = amt;
    const swappedFrom = from.symbol;
    const swappedTo = to.symbol;

    const shortfall = amountRaw > vaultBalanceRaw ? amountRaw - vaultBalanceRaw : 0n;
    let stepIdx = 0;

    if (shortfall > 0n) {
      if (from.address !== zeroAddress) {
        const allowance = (await publicClient.readContract({
          address: from.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, VEILSWAP_ADDRESS],
        })) as bigint;
        if (allowance < shortfall) {
          const approveHash = await writeContractAsync({ address: from.address, abi: ERC20_ABI, functionName: "approve", args: [VEILSWAP_ADDRESS, shortfall] });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        stepIdx += 1;
        onStep(stepIdx); // "Depositing to swap vault"
        const depositHash = await writeContractAsync({ address: VEILSWAP_ADDRESS, abi: VEILSWAP_ABI, functionName: "deposit", args: [from.address, shortfall] });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
        stepIdx += 1;
        onStep(stepIdx); // "Recording deposit"
        await api.post<VeilswapDepositResponse>("/veilswap/deposits", { txHash: depositHash });
      } else {
        stepIdx += 1;
        onStep(stepIdx); // "Depositing to swap vault"
        const depositHash = await writeContractAsync({ address: VEILSWAP_ADDRESS, abi: VEILSWAP_ABI, functionName: "deposit", args: [zeroAddress, shortfall], value: shortfall });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
        stepIdx += 1;
        onStep(stepIdx); // "Recording deposit"
        await api.post<VeilswapDepositResponse>("/veilswap/deposits", { txHash: depositHash });
      }
    }

    stepIdx += 1;
    const swapExecutingStep = stepIdx;
    onStep(swapExecutingStep); // "Executing swap"
    const idempotencyKey = crypto.randomUUID();
    await api.post("/swaps", {
      idempotencyKey,
      tokenIn: from.address,
      tokenOut: to.address,
      amountIn: amountRaw.toString(),
      amountOutMin: "0",
      poolKey: pair.poolKey,
    });

    const payingOutStep = swapExecutingStep + 1;
    const result = await pollSwap(idempotencyKey, onStep, { swapExecuting: swapExecutingStep, payingOut: payingOutStep });

    invalidateAfterAction();
    setAmt("");
    return {
      txHash: result.adminWithdrawTxHash,
      summary: `Swapped ${swappedAmt} ${swappedFrom} for ${result.amountOut ? formatUnits(BigInt(result.amountOut), to.decimals) : "?"} ${swappedTo}.`,
    };
  }

  function submit() {
    const shortfall = amountRaw && amountRaw > vaultBalanceRaw ? amountRaw - vaultBalanceRaw : 0n;
    const steps = shortfall > 0n
      ? ["Approving", "Depositing to swap vault", "Recording deposit", "Executing swap", "Paying out"]
      : ["Executing swap", "Paying out"];
    confirm({
      title: "Confirm shielded swap",
      rows: [
        ["Swapping", `${amt || "0"} ${from.symbol}`],
        ["You receive (est.)", quoteQuery.data ? `${fmtBal(Number(formatUnits(BigInt(quoteQuery.data.amountOut), to.decimals)))} ${to.symbol}` : "—"],
        ["Route", `${from.symbol} → ${to.symbol} via V4`],
      ],
      cta: "Swap privately",
      steps: from.address === zeroAddress ? steps.filter((s) => s !== "Approving") : steps,
      action: doSwap,
    });
  }

  const exceedsAvailable = Boolean(amountRaw) && amountRaw! > maxPayAmountRaw;
  const canSubmit = Boolean(pair) && Boolean(amountRaw) && Boolean(quoteQuery.data) && !exceedsAvailable;

  return (
    <div className="wrap-n">
      <Panel action={<Tabs items={[{ id: "eth-usdg", label: "ETH → USDG" }, { id: "usdg-eth", label: "USDG → ETH" }]} active={dir} onChange={(v) => setDir(v as Direction)} />} title="Swap">
        <div style={{ marginTop: 14 }}>
          <p className="desc" style={{ marginBottom: 14 }}>
            Swaps route through the real Uniswap V4 pool on Robinhood Chain, executed by the shielded VeiledhoodSwap vault. Funds not already shielded there are deposited first.
          </p>
          <div className="pbar" style={{ marginBottom: 14 }}>
            <IcShield size={15} />
            <span className="pt">No separate deposit needed — swap straight from your wallet. Any amount not already in the shielded swap vault is deposited automatically as part of the swap.</span>
          </div>
          <AssetInput
            label="You pay"
            value={amt}
            onChange={setAmt}
            token={{ sym: from.symbol, chain: "Robinhood Chain" }}
            balanceLabel={
              vaultBalanceRaw > 0n ? (
                <>
                  Shielded {fmtBal(Number(formatUnits(vaultBalanceRaw, from.decimals)))} {from.symbol}
                  {rawWalletBalance ? ` · Wallet ${fmtBal(Number(formattedWalletBalance))}` : ""}
                </>
              ) : (
                <>Wallet {formattedWalletBalance ? fmtBal(Number(formattedWalletBalance)) : "0.00"} {from.symbol}</>
              )
            }
            onMax={maxPayAmountRaw > 0n ? () => setAmt(formatUnits(maxPayAmountRaw, from.decimals)) : undefined}
          />
          <AssetInput
            label="You receive (est.)"
            value={quoteQuery.data ? fmtBal(Number(formatUnits(BigInt(quoteQuery.data.amountOut), to.decimals))) : ""}
            token={{ sym: to.symbol, chain: "Robinhood Chain" }}
            readOnly
          />
          <div style={{ marginTop: 14 }}>
            <DRow k="Fee" v="Pool fee only (0.046%)" />
          </div>
          {!VEILSWAP_ADDRESS && <div className="desc" style={{ color: "var(--neg)", marginTop: 10 }}>Swap isn't deployed on this deployment yet.</div>}
          {VEILSWAP_ADDRESS && !pair && !pairsQuery.isLoading && <div className="desc" style={{ color: "var(--neg)", marginTop: 10 }}>Pair not supported.</div>}
          {exceedsAvailable && <div className="desc" style={{ color: "var(--neg)", marginTop: 10 }}>Exceeds shielded + wallet balance.</div>}
          <div style={{ marginTop: 18 }}>
            <Btn kind="pri" block onClick={submit} disabled={!VEILSWAP_ADDRESS || !canSubmit}>
              Swap privately
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}
