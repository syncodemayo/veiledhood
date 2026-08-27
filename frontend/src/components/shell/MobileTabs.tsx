import type { RouteId } from "./navConfig";
import { IcPortfolio, IcSwap, IcVault, IcAgent, IcSettings } from "../icons/Icons";
import { cx } from "../primitives/primitives";

const ITEMS: { id: RouteId; label: string; icon: typeof IcPortfolio }[] = [
  { id: "portfolio", label: "Portfolio", icon: IcPortfolio },
  { id: "vault", label: "Vault", icon: IcVault },
  { id: "swap", label: "Swap", icon: IcSwap },
  { id: "agent", label: "Agent", icon: IcAgent },
  { id: "settings", label: "More", icon: IcSettings },
];

export function MobileTabs({ route, go }: { route: RouteId; go: (id: RouteId) => void }) {
  return (
    <nav className="mtabs">
      {ITEMS.map((i) => {
        const I = i.icon;
        return (
          <button key={i.id} className={cx("mtab", route === i.id && "on")} onClick={() => go(i.id)}>
            <I size={19} />
            {i.label}
          </button>
        );
      })}
    </nav>
  );
}
