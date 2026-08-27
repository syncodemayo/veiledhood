import { NAV, type RouteId } from "./navConfig";
import { Mark, IcSettings, IcArrow } from "../icons/Icons";
import { cx, usd } from "../primitives/primitives";

export function Rail({
  route,
  go,
  open,
  onClose,
  wallet,
  totalUsd,
}: {
  route: RouteId;
  go: (id: RouteId) => void;
  open: boolean;
  onClose: () => void;
  wallet: string;
  totalUsd: number;
}) {
  return (
    <aside className={cx("rail", open && "open")}>
      <div className="rail-logo">
        <span style={{ color: "var(--vio-lift)" }}>
          <Mark size={26} />
        </span>
        <span className="lw">
          Veiled<span className="b">Hood</span>
        </span>
      </div>
      <nav className="rail-nav">
        {NAV.map((g) => (
          <div className="ngrp" key={g.group}>
            <div className="gt">{g.group}</div>
            {g.items.map((i) => {
              const I = i.icon;
              return (
                <button
                  key={i.id}
                  className={cx("nitem focus-ring", route === i.id && "on")}
                  onClick={() => {
                    go(i.id);
                    onClose();
                  }}
                >
                  <span className="ni">
                    <I size={17} />
                  </span>
                  {i.label}
                  {i.badge && <span className="nb">{i.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="rail-foot">
        <button
          className="nitem focus-ring"
          onClick={() => {
            go("settings");
            onClose();
          }}
          style={route === "settings" ? { background: "var(--vio-dim)", color: "var(--tx)" } : undefined}
        >
          <span className="ni">
            <IcSettings size={17} />
          </span>
          Settings
        </button>
        <button className="wchip focus-ring" onClick={() => go("settings")}>
          <span className="wa" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="wn trunc" style={{ display: "block" }}>
              {wallet.slice(0, 6)}…{wallet.slice(-4)}
            </span>
            <span className="wv" style={{ display: "block" }}>
              {usd(totalUsd, 0)}
            </span>
          </span>
          <span style={{ color: "var(--tx4)" }}>
            <IcArrow size={14} />
          </span>
        </button>
      </div>
    </aside>
  );
}
