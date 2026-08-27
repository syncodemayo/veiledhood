// VeiledHood — primitives
// NOTE: no top-level hook destructuring — Babel scripts share global scope.
const cx = (...a) => a.filter(Boolean).join(' ');
const fmt = (n, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n, d = 2) => '$' + fmt(n, d);

const Btn = ({ kind = 'sec', size = 'md', block, children, icon, className, ...r }) => (
  <button className={cx('btn focus-ring', `btn-${kind}`, `btn-${size}`, block && 'btn-block', className)} {...r}>
    {icon}{children}
  </button>
);

const IconBtn = ({ children, label, ...r }) => (
  <button className="btn btn-icon focus-ring" aria-label={label} title={label} {...r}>{children}</button>
);

const Pill = ({ tone = 'mute', dot, children }) => (
  <span className={cx('pill', `pill-${tone}`)}>{dot && <i />}{children}</span>
);

const Panel = ({ title, action, children, pad = true, className, kicker }) => (
  <section className={cx('panel', className)}>
    {(title || action) && (
      <header className="panel-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          {kicker && <div className="lbl" style={{ marginBottom: 5 }}>{kicker}</div>}
          <div className="t">{title}</div>
        </div>
        {action}
      </header>
    )}
    <div className={pad ? 'panel-b' : ''}>{children}</div>
  </section>
);

const Stat = ({ label, value, sub, delta, size = 30, mono = true }) => (
  <div className="stat">
    <div className="lbl">{label}</div>
    <div className="sv" style={{ fontSize: size, marginTop: 11, fontFamily: mono ? 'var(--mono)' : 'var(--sans)' }}>{value}</div>
    {(sub || delta != null) && (
      <div className="sd">
        {delta != null && <span className={delta >= 0 ? 'pos' : 'neg'}>{delta >= 0 ? '+' : ''}{fmt(delta)}%</span>}
        {sub && <span style={{ color: 'var(--tx3)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 400 }}>{sub}</span>}
      </div>
    )}
  </div>
);

const TokDot = ({ sym, color }) => (
  <span className="tokdot" style={{ background: color || 'var(--p4)' }}>{sym.slice(0, 2)}</span>
);

const AssetInput = ({ label, value, onChange, token, balance, usdValue, readOnly, onMax, onTokenClick }) => (
  <div className="ai">
    <div className="ai-top">
      <span className="lbl">{label}</span>
      {balance != null && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--tx3)' }}>
          Balance {fmt(balance, 4)}
          {onMax && <button onClick={onMax} className="vio" style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500 }}>MAX</button>}
        </span>
      )}
    </div>
    <div className="ai-row">
      <input className="ai-in" value={value} onChange={e => onChange && onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" readOnly={readOnly} inputMode="decimal" />
      <button className="tokbtn" onClick={onTokenClick}>
        <TokDot sym={token.sym} color={token.color} />{token.sym}
      </button>
    </div>
    <div className="ai-bot">
      <span>{usdValue != null ? usd(usdValue) : '—'}</span>
      <span>{token.chain}</span>
    </div>
  </div>
);

const Toggle = ({ on, onChange }) => (
  <button className={cx('tg focus-ring', on && 'on')} onClick={() => onChange(!on)} role="switch" aria-checked={on}><i /></button>
);

const ToggleRow = ({ title, desc, on, onChange, icon }) => (
  <div className="tgrow">
    {icon && <span className="lico" style={{ width: 32, height: 32 }}>{icon}</span>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="tt">{title}</div>
      <div className="tx">{desc}</div>
    </div>
    <Toggle on={on} onChange={onChange} />
  </div>
);

const DRow = ({ k, v, tone, hint }) => (
  <div className="drow">
    <span className="dk">{k}{hint && <span title={hint} style={{ color: 'var(--tx4)', cursor: 'help' }}>ⓘ</span>}</span>
    <span className={cx('dv', tone)}>{v}</span>
  </div>
);

const ListRow = ({ icon, title, sub, value, valueSub, tone, onClick, end }) => (
  <div className={cx('lrow', onClick && 'hov')} onClick={onClick}>
    {icon && <span className="lico">{icon}</span>}
    <div className="lmain"><div className="lt trunc">{title}</div>{sub && <div className="lx trunc">{sub}</div>}</div>
    {end || (value != null && (
      <div className="lend"><div className={cx('lv', tone)}>{value}</div>{valueSub && <div className="lx">{valueSub}</div>}</div>
    ))}
  </div>
);

const Tabs = ({ items, active, onChange }) => (
  <div className="tabs">{items.map(i => (
    <button key={i.id} className={cx('tab', active === i.id && 'on')} onClick={() => onChange(i.id)}>{i.label}</button>
  ))}</div>
);

const Empty = ({ icon, title, desc, action }) => (
  <div className="empty">
    <span className="ei">{icon}</span>
    <div className="et">{title}</div>
    <div className="ex">{desc}</div>
    {action && <div style={{ marginTop: 16 }}>{action}</div>}
  </div>
);

const Sk = ({ w = '100%', h = 12, r = 6, style }) => (
  <div className="sk shimmer" style={{ width: w, height: h, borderRadius: r, ...style }} />
);

const Modal = ({ title, icon, onClose, children, footer, wide }) => {
  React.useEffect(() => {
    const k = e => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="mbd" onClick={onClose}>
      <div className="mdl" style={wide ? { maxWidth: 560 } : null} onClick={e => e.stopPropagation()}>
        <header className="mdl-h">
          {icon && <span className="lico" style={{ width: 32, height: 32 }}>{icon}</span>}
          <span className="mt">{title}</span>
          <IconBtn label="Close" onClick={onClose}><IcClose size={17} /></IconBtn>
        </header>
        <div className="mdl-b">{children}</div>
        {footer && <footer className="mdl-f">{footer}</footer>}
      </div>
    </div>
  );
};

const Step = ({ n, title, desc, state }) => (
  <div className={cx('step', state)}>
    <span className="step-i">{state === 'done' ? <IcCheck size={13} /> : state === 'act' ? <span className="spin" style={{ display: 'block', width: 11, height: 11, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} /> : n}</span>
    <div><div className="step-t">{title}</div><div className="step-x">{desc}</div></div>
  </div>
);

// value series → smoothed polyline
const Spark = ({ data, w = 132, h = 40, color = 'var(--vio-lift)', fill = true }) => {
  const mn = Math.min(...data), mx = Math.max(...data), rg = mx - mn || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - mn) / rg) * (h - 5) - 2.5]);
  const d = pts.map((p, i) => (i ? `L${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`)).join(' ');
  const id = 'sg' + Math.abs(data[0] * 997 | 0);
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".26" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} style={{ color }} /></>}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// two-segment ring: shielded vs public
const Ring = ({ pct, size = 118, stroke = 13 }) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--p3)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--vio)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * pct / 100).toFixed(2)} ${c.toFixed(2)}`} />
    </svg>
  );
};

const Bars = ({ data, h = 44, color = 'var(--vio)' }) => {
  const mx = Math.max(...data) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: h }}>
      {data.map((v, i) => <div key={i} style={{ flex: 1, height: `${Math.max(8, (v / mx) * 100)}%`, background: i === data.length - 1 ? color : 'var(--p4)', borderRadius: 2 }} />)}
    </div>
  );
};

const Addr = ({ a, onCopy }) => (
  <button className="pill pill-mute" onClick={onCopy} style={{ cursor: 'pointer' }}>
    {a.slice(0, 6)}…{a.slice(-4)}<IcCopy size={11} />
  </button>
);

const Toast = ({ title, desc, onDone }) => {
  React.useEffect(() => { const t = setTimeout(onDone, 3400); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="toast">
      <span className="lico" style={{ width: 30, height: 30, color: 'var(--pos)', background: 'var(--pos-dim)' }}><IcCheck size={15} /></span>
      <div><div className="tt">{title}</div>{desc && <div className="tx">{desc}</div>}</div>
    </div>
  );
};

Object.assign(window, { cx, fmt, usd, Btn, IconBtn, Pill, Panel, Stat, TokDot, AssetInput, Toggle, ToggleRow, DRow, ListRow, Tabs, Empty, Sk, Modal, Step, Spark, Ring, Bars, Addr, Toast });
