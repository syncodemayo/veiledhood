import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "ethers";
import { api } from "../lib/api";
import { usePrivacy, Mask } from "../context/PrivacyContext";
import { Panel, Stat, Ring, ListRow, Pill, Sk, usd, fmt } from "../components/primitives/primitives";
import { IcHistory, IcExternal } from "../components/icons/Icons";
import type { WalletContextFull, UserActivityResponse, ActivityItem } from "../types/api";
import { ROBINHOOD_TESTNET_EXPLORER } from "../lib/wallet";
import { resolveCurrency } from "../config/vaultAssets";

function formatCurrencyAmount(rawAmount: string, currency: string): string {
  const asset = resolveCurrency(currency);
  const decimals = asset?.decimals ?? 18;
  return fmt(Number(formatUnits(rawAmount, decimals)), 2);
}

function currencySymbol(currency: string): string {
  const asset = resolveCurrency(currency);
  if (asset) return asset.symbol;
  if (currency.toLowerCase() === "native") return "ETH";
  return `${currency.slice(0, 6)}…${currency.slice(-4)}`;
}

function activityLabel(item: ActivityItem): { title: string; sub: string; value: string } {
  const amount = formatCurrencyAmount(item.amount, item.currency);
  const sym = currencySymbol(item.currency);
  if (item.kind === "deposit") return { title: "Deposit", sub: sym, value: `+${amount} ${sym}` };
  if (item.kind === "withdraw") return { title: "Withdraw", sub: sym, value: `-${amount} ${sym}` };
  return {
    title: item.direction === "out" ? "Sent" : "Received",
    sub: `${item.counterparty.slice(0, 6)}…${item.counterparty.slice(-4)}`,
    value: `${item.direction === "out" ? "-" : "+"}${amount} ${sym}`,
  };
}

export function Portfolio() {
  const { visible } = usePrivacy();

  const ctxQuery = useQuery({
    queryKey: ["context-full"],
    queryFn: () => api.post<WalletContextFull>("/context/full", {}),
  });
  const activityQuery = useQuery({
    queryKey: ["user-activity"],
    queryFn: () => api.get<UserActivityResponse>("/user/activity?limit=20"),
  });

  const ctx = ctxQuery.data;
  const shieldedUsd = ctx?.shielded.totalUsd ?? 0;
  const publicUsd = ctx?.public.totalUsd ?? 0;
  const totalUsd = ctx?.totalUsd ?? 0;
  const pct = totalUsd > 0 ? (shieldedUsd / totalUsd) * 100 : 0;

  const loading = ctxQuery.isLoading;

  const holdings = [
    ...(ctx?.shielded.balances.map((b) => ({
      sym: (b.symbol ?? currencySymbol(b.currency)).toUpperCase(),
      amt: Number(formatUnits(b.amount, b.decimals ?? resolveCurrency(b.currency)?.decimals ?? 18)),
      usd: b.usdValue,
      shielded: true,
    })) ?? []),
    ...(ctx?.public.tokens.filter((t) => Number(t.balance) > 0).map((t) => ({
      sym: t.symbol,
      amt: Number(formatUnits(t.balance, t.decimals)),
      usd: t.usdValue,
      shielded: false,
    })) ?? []),
    ...(ctx?.public.native.balance && Number(ctx.public.native.balance) > 0
      ? [{ sym: ctx.public.native.symbol, amt: Number(formatUnits(ctx.public.native.balance, 18)), usd: ctx.public.native.usdValue, shielded: false }]
      : []),
  ];

  return (
    <div className="wrap">
      <div className="g4">
        {loading ? (
          <>
            <Sk h={90} /><Sk h={90} /><Sk h={90} /><Sk h={90} />
          </>
        ) : (
          <>
            <Panel>
              <Stat label="Total balance" value={<Mask show={visible}>{usd(totalUsd, 2)}</Mask>} />
            </Panel>
            <Panel className="panel" style={{ boxShadow: "0 0 0 5px rgba(130,87,255,.06)", borderColor: "var(--vio)" }}>
              <Stat label="Shielded" value={<Mask show={visible}>{usd(shieldedUsd, 2)}</Mask>} sub={`${fmt(pct, 0)}% of total`} />
            </Panel>
            <Panel>
              <Stat label="Public" value={<Mask show={visible}>{usd(publicUsd, 2)}</Mask>} sub={`${fmt(100 - pct, 0)}% of total`} />
            </Panel>
            <Panel>
              <Stat label="Positions" value="0" mono={false} />
            </Panel>
          </>
        )}
      </div>

      <div className="g2">
        <Panel title="Shielded vs public" kicker="Split">
          {loading ? (
            <Sk h={140} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <Ring pct={pct} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                {holdings.length === 0 && <div className="desc">No balances yet — deposit in Vault to get started.</div>}
                {holdings.map((h, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span style={{ color: "var(--tx2)" }}>
                      {h.sym} {h.shielded && <Pill tone="vio">Shielded</Pill>}
                    </span>
                    <span className="num">
                      <Mask show={visible}>{fmt(h.amt, 2)}</Mask>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Balance" kicker="Snapshot" action={<IcHistory size={15} style={{ color: "var(--tx4)" }} />}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 140, gap: 6 }}>
            <div className="num" style={{ fontSize: 28, fontWeight: 500 }}>
              <Mask show={visible}>{usd(totalUsd, 2)}</Mask>
            </div>
            <div className="desc">Historical charting coming soon.</div>
          </div>
        </Panel>
      </div>

      <Panel title="Activity" pad={false}>
        {activityQuery.isLoading && <div style={{ padding: 18 }}><Sk h={40} /></div>}
        {activityQuery.data?.items.length === 0 && <div className="empty"><div className="et">No activity yet</div><div className="ex">Deposits, withdrawals and transfers will show up here.</div></div>}
        {activityQuery.data?.items.map((item, i) => {
          const l = activityLabel(item);
          const txHash = item.kind !== "transfer" ? item.txHash : item.adminWithdrawTxHash ?? undefined;
          return (
            <ListRow
              key={i}
              title={l.title}
              sub={l.sub}
              value={<Mask show={visible}>{l.value}</Mask>}
              tone={l.value.startsWith("+") ? "pos" : l.value.startsWith("-") ? "neg" : undefined}
              end={
                txHash ? (
                  <a
                    href={`${ROBINHOOD_TESTNET_EXPLORER}/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="lend"
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      color: l.value.startsWith("+") ? "var(--pos)" : l.value.startsWith("-") ? "var(--neg)" : "var(--tx3)",
                    }}
                  >
                    <Mask show={visible}>{l.value}</Mask>
                    <IcExternal size={12} />
                  </a>
                ) : undefined
              }
            />
          );
        })}
      </Panel>
    </div>
  );
}
