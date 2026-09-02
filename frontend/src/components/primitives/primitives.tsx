import { useEffect, useId, type ReactNode, type ButtonHTMLAttributes } from "react";
import { IcCheck, IcClose, IcCopy, IcAlert, IcTokenEth, Mark } from "../icons/Icons";
import usdgLogo from "../../assets/tokens/usdg.png";
import nvdaLogo from "../../assets/tokens/nvda.svg";
import tslaLogo from "../../assets/tokens/tsla.svg";
import spcxLogo from "../../assets/tokens/spcx.svg";
import aaplLogo from "../../assets/tokens/aapl.svg";
import ttwoLogo from "../../assets/tokens/ttwo.svg";

export const cx = (...a: Array<string | false | undefined | null>) => a.filter(Boolean).join(" ");
export const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const usd = (n: number, d = 2) => "$" + fmt(n, d);
/** Like fmt(n, 2), but for values under 0.01 shows the first 2 non-zero decimal digits instead of rounding to 0.00. */
export const fmtBal = (n: number): string => {
  if (n === 0 || Math.abs(n) >= 0.01) return fmt(n, 2);
  const d = Math.max(2, -Math.floor(Math.log10(Math.abs(n))) + 1);
  return fmt(n, d);
};

export const Btn = ({
  kind = "sec",
  size = "md",
  block,
  children,
  icon,
  className,
  ...r
}: {
  kind?: "sec" | "pri" | "ghost";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={cx("btn focus-ring", `btn-${kind}`, `btn-${size}`, block && "btn-block", className)} {...r}>
    {icon}
    {children}
  </button>
);

export const IconBtn = ({ children, label, ...r }: { children: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className="btn btn-icon focus-ring" aria-label={label} title={label} {...r}>
    {children}
  </button>
);

export const Pill = ({ tone = "mute", dot, children }: { tone?: string; dot?: boolean; children: ReactNode }) => (
  <span className={cx("pill", `pill-${tone}`)}>
    {dot && <i />}
    {children}
  </span>
);

export const Panel = ({
  title,
  action,
  children,
  pad = true,
  className,
  kicker,
  style,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  pad?: boolean;
  className?: string;
  kicker?: ReactNode;
  style?: React.CSSProperties;
}) => (
  <section className={cx("panel", className)} style={style}>
    {(title || action) && (
      <header className="panel-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          {kicker && (
            <div className="lbl" style={{ marginBottom: 5 }}>
              {kicker}
            </div>
          )}
          <div className="t">{title}</div>
        </div>
        {action}
      </header>
    )}
    <div className={pad ? "panel-b" : ""}>{children}</div>
  </section>
);

export const Stat = ({
  label,
  value,
  sub,
  delta,
  size = 30,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  size?: number;
  mono?: boolean;
}) => (
  <div className="stat">
    <div className="lbl">{label}</div>
    <div className="sv" style={{ fontSize: size, marginTop: 11, fontFamily: mono ? "var(--mono)" : "var(--sans)" }}>
      {value}
    </div>
    {(sub || delta != null) && (
      <div className="sd">
        {delta != null && (
          <span className={delta >= 0 ? "pos" : "neg"}>
            {delta >= 0 ? "+" : ""}
            {fmt(delta)}%
          </span>
        )}
        {sub && <span style={{ color: "var(--tx3)", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 400 }}>{sub}</span>}
      </div>
    )}
  </div>
);

/** Circular badge wrapper for wordmark logos (imported as SVG asset URLs) that need a background. */
const TokLogoImg = ({ src, size = 26 }: { src: string; size?: number }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: "#fff",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      flexShrink: 0,
    }}
  >
    <img src={src} alt="" style={{ width: "64%", height: "64%", objectFit: "contain" }} />
  </span>
);

/** For logos that are already a filled circular badge (e.g. CoinGecko coin images) — no extra background needed. */
const TokLogoCircle = ({ src, size = 26 }: { src: string; size?: number }) => (
  <img src={src} alt="" style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }} />
);

/** VeiledHood's own mark (see FE-design/brand/BRAND.txt) — violet-lift on an ink ground, per brand guide. */
const TokMarkVeil = ({ size = 26 }: { size?: number }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: "#08090B",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#A88CFF",
      flexShrink: 0,
    }}
  >
    <Mark size={size * 0.72} compact={size <= 20} />
  </span>
);

const TOKEN_ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  ETH: IcTokenEth,
  USDG: (p) => <TokLogoCircle src={usdgLogo} size={p.size} />,
  VEILEDHOOD: (p) => <TokMarkVeil size={p.size} />,
  NVDA: (p) => <TokLogoImg src={nvdaLogo} size={p.size} />,
  TSLA: (p) => <TokLogoImg src={tslaLogo} size={p.size} />,
  SPCX: (p) => <TokLogoImg src={spcxLogo} size={p.size} />,
  AAPL: (p) => <TokLogoImg src={aaplLogo} size={p.size} />,
  TTWO: (p) => <TokLogoImg src={ttwoLogo} size={p.size} />,
  // PONS: no real-world logo found online — falls back to the default letter badge.
};

export const TokDot = ({ sym, color }: { sym: string; color?: string }) => {
  const RealIcon = TOKEN_ICONS[sym.toUpperCase()];
  if (RealIcon) return <RealIcon size={26} />;
  return (
    <span className="tokdot" style={{ background: color || "var(--p4)" }}>
      {sym.slice(0, 2)}
    </span>
  );
};

export interface TokenLike {
  sym: string;
  color?: string;
  chain: string;
}

export const AssetInput = ({
  label,
  value,
  onChange,
  token,
  balance,
  balanceLabel,
  usdValue,
  readOnly,
  onMax,
  onTokenClick,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  token: TokenLike;
  balance?: number | null;
  /** Override the default "Balance {n}" text (e.g. to show a shielded/wallet split). */
  balanceLabel?: ReactNode;
  usdValue?: number | null;
  readOnly?: boolean;
  onMax?: () => void;
  onTokenClick?: () => void;
}) => (
  <div className="ai">
    <div className="ai-top">
      <span className="lbl">{label}</span>
      {(balanceLabel != null || balance != null) && (
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--tx3)" }}>
          {balanceLabel ?? <>Balance {fmtBal(balance!)}</>}
          {onMax && (
            <button onClick={onMax} className="vio" style={{ marginLeft: 8, fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>
              MAX
            </button>
          )}
        </span>
      )}
    </div>
    <div className="ai-row">
      <input
        className="ai-in"
        value={value}
        onChange={(e) => onChange && onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder="0.00"
        readOnly={readOnly}
        inputMode="decimal"
      />
      <button className="tokbtn" onClick={onTokenClick}>
        <TokDot sym={token.sym} color={token.color} />
        {token.sym}
      </button>
    </div>
    <div className="ai-bot">
      <span>{usdValue != null ? usd(usdValue) : "—"}</span>
      <span>{token.chain}</span>
    </div>
  </div>
);

export const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button className={cx("tg focus-ring", on && "on")} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
    <i />
  </button>
);

export const ToggleRow = ({
  title,
  desc,
  on,
  onChange,
  icon,
}: {
  title: ReactNode;
  desc: ReactNode;
  on: boolean;
  onChange: (v: boolean) => void;
  icon?: ReactNode;
}) => (
  <div className="tgrow">
    {icon && (
      <span className="lico" style={{ width: 32, height: 32 }}>
        {icon}
      </span>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="tt">{title}</div>
      <div className="tx">{desc}</div>
    </div>
    <Toggle on={on} onChange={onChange} />
  </div>
);

export const DRow = ({ k, v, tone, hint }: { k: ReactNode; v: ReactNode; tone?: string; hint?: string }) => (
  <div className="drow">
    <span className="dk">
      {k}
      {hint && (
        <span title={hint} style={{ color: "var(--tx4)", cursor: "help" }}>
          ⓘ
        </span>
      )}
    </span>
    <span className={cx("dv", tone)}>{v}</span>
  </div>
);

export const ListRow = ({
  icon,
  title,
  sub,
  value,
  valueSub,
  tone,
  onClick,
  end,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueSub?: ReactNode;
  tone?: string;
  onClick?: () => void;
  end?: ReactNode;
}) => (
  <div className={cx("lrow", onClick && "hov")} onClick={onClick}>
    {icon && <span className="lico">{icon}</span>}
    <div className="lmain">
      <div className="lt trunc">{title}</div>
      {sub && <div className="lx trunc">{sub}</div>}
    </div>
    {end ||
      (value != null && (
        <div className="lend">
          <div className={cx("lv", tone)}>{value}</div>
          {valueSub && <div className="lx">{valueSub}</div>}
        </div>
      ))}
  </div>
);

export const Tabs = ({ items, active, onChange }: { items: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) => (
  <div className="tabs">
    {items.map((i) => (
      <button key={i.id} className={cx("tab", active === i.id && "on")} onClick={() => onChange(i.id)}>
        {i.label}
      </button>
    ))}
  </div>
);

export const Empty = ({ icon, title, desc, action }: { icon?: ReactNode; title: ReactNode; desc?: ReactNode; action?: ReactNode }) => (
  <div className="empty">
    <span className="ei">{icon}</span>
    <div className="et">{title}</div>
    <div className="ex">{desc}</div>
    {action && <div style={{ marginTop: 16 }}>{action}</div>}
  </div>
);

export const Sk = ({ w = "100%", h = 12, r = 6, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) => (
  <div className="sk shimmer" style={{ width: w, height: h, borderRadius: r, ...style }} />
);

export const Modal = ({
  title,
  icon,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) => {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="mbd" onClick={onClose}>
      <div className="mdl" style={wide ? { maxWidth: 560 } : undefined} onClick={(e) => e.stopPropagation()}>
        <header className="mdl-h">
          {icon && (
            <span className="lico" style={{ width: 32, height: 32 }}>
              {icon}
            </span>
          )}
          <span className="mt">{title}</span>
          <IconBtn label="Close" onClick={onClose}>
            <IcClose size={17} />
          </IconBtn>
        </header>
        <div className="mdl-b">{children}</div>
        {footer && <footer className="mdl-f">{footer}</footer>}
      </div>
    </div>
  );
};

export const Step = ({ n, title, desc, state }: { n: number; title: ReactNode; desc: ReactNode; state?: "" | "act" | "done" }) => (
  <div className={cx("step", state)}>
    <span className="step-i">
      {state === "done" ? (
        <IcCheck size={13} />
      ) : state === "act" ? (
        <span
          className="spin"
          style={{ display: "block", width: 11, height: 11, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }}
        />
      ) : (
        n
      )}
    </span>
    <div>
      <div className="step-t">{title}</div>
      <div className="step-x">{desc}</div>
    </div>
  </div>
);

export const Spark = ({ data, w = 132, h = 40, color = "var(--vio-lift)", fill = true }: { data: number[]; w?: number; h?: number; color?: string; fill?: boolean }) => {
  const rid = useId().replace(/[:]/g, "");
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const rg = mx - mn || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - mn) / rg) * (h - 5) - 2.5]);
  const d = pts.map((p, i) => (i ? `L${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`)).join(" ");
  const id = "sg" + rid;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity=".26" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} style={{ color }} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const Ring = ({ pct, size = 118, stroke = 13 }: { pct: number; size?: number; stroke?: number }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ display: "block", transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--p3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--vio)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${((c * pct) / 100).toFixed(2)} ${c.toFixed(2)}`}
      />
    </svg>
  );
};

export const Bars = ({ data, h = 44, color = "var(--vio)" }: { data: number[]; h?: number; color?: string }) => {
  const mx = Math.max(...data) || 1;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: h }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{ flex: 1, height: `${Math.max(8, (v / mx) * 100)}%`, background: i === data.length - 1 ? color : "var(--p4)", borderRadius: 2 }}
        />
      ))}
    </div>
  );
};

export const Addr = ({ a, onCopy }: { a: string; onCopy?: () => void }) => (
  <button className="pill pill-mute" onClick={onCopy} style={{ cursor: "pointer" }}>
    {a.slice(0, 6)}…{a.slice(-4)}
    <IcCopy size={11} />
  </button>
);

export const Toast = ({ title, desc, onDone, tone = "pos" }: { title: ReactNode; desc?: ReactNode; onDone: () => void; tone?: "pos" | "neg" }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 3400);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="toast" style={tone === "neg" ? { borderLeftColor: "var(--neg)" } : undefined}>
      <span className="lico" style={{ width: 30, height: 30, color: `var(--${tone})`, background: `var(--${tone}-dim)` }}>
        {tone === "neg" ? <IcAlert size={15} /> : <IcCheck size={15} />}
      </span>
      <div>
        <div className="tt">{title}</div>
        {desc && <div className="tx">{desc}</div>}
      </div>
    </div>
  );
};
