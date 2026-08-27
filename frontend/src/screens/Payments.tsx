import { useQuery } from "@tanstack/react-query";
import { Panel, Empty, ListRow, Pill } from "../components/primitives/primitives";
import { IcPay } from "../components/icons/Icons";
import { api } from "../lib/api";
import type { X402DiscoveryResponse } from "../types/api";

export function Payments() {
  const discovery = useQuery({
    queryKey: ["x402-discovery"],
    queryFn: () => api.get<X402DiscoveryResponse>("/.well-known/x402-bazaar.json"),
  });

  const enabled = discovery.data?.enabled ?? false;

  return (
    <div className="wrap">
      <Panel title="x402 payments" kicker="Discovery">
        {!enabled ? (
          <Empty icon={<IcPay size={22} />} title="x402 payments aren't enabled on this deployment" desc="The discovery endpoint responds (it's a live, working route), but X402_ENABLED is false server-side, so no paid endpoints or settlement flow exist yet." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {discovery.data?.endpoints.map((e) => (
              <ListRow key={e.path} title={e.path} sub={e.description} value={`${e.price.atomic} ${e.price.asset.slice(0, 8)}…`} />
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Settlement history">
        <Empty icon={<IcPay size={22} />} title="No payment history backend" desc="There's no invoice/settlement store on this API — this list has nothing real to show." />
      </Panel>
      <div style={{ marginTop: 4 }}>
        <Pill tone="mute">Facilitator: {discovery.data?.enabled ? "configured" : "not configured"}</Pill>
      </div>
    </div>
  );
}
