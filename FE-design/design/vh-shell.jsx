// VeiledHood — shell
const NAV = [
  { group: 'Trade', items: [
    { id: 'swap', label: 'Swap', icon: IcSwap },
    { id: 'bridge', label: 'Bridge', icon: IcBridge },
    { id: 'vault', label: 'Vault', icon: IcVault },
  ]},
  { group: 'Assets', items: [
    { id: 'portfolio', label: 'Portfolio', icon: IcPortfolio },
    { id: 'staking', label: 'Staking', icon: IcStake },
  ]},
  { group: 'Private', items: [
    { id: 'data', label: 'Data', icon: IcData },
    { id: 'agent', label: 'Agent', icon: IcAgent, badge: 'AI' },
    { id: 'mcp', label: 'MCP', icon: IcMcp, badge: '2' },
    { id: 'payments', label: 'Payments', icon: IcPay },
  ]},
];

const TITLES = {
  portfolio: ['Portfolio', 'Shielded and public balances in one view'],
  swap: ['Swap', 'Trade without publishing the trail'],
  bridge: ['Bridge', 'Move value in and out of the shielded pool'],
  vault: ['Vault', 'Deposit to shield, withdraw to reveal'],
  staking: ['Staking', 'Earn on shielded positions'],
  data: ['Encrypted data', 'Ciphertext at rest — your key never leaves'],
  agent: ['Agent', 'Private inference over your own context'],
  mcp: ['MCP server', 'Give agents tools without giving them plaintext'],
  payments: ['Agent payments', 'Pay-per-call settlement on stealth addresses'],
  settings: ['Settings', 'Privacy defaults and connected surfaces'],
};

const Rail = ({ route, go, open, onClose, wallet }) => (
  <aside className={cx('rail', open && 'open')}>
    <div className="rail-logo">
      <span style={{ color: 'var(--vio-lift)' }}><Mark size={26} /></span>
      <span className="lw">Veiled<span className="b">Hood</span></span>
    </div>
    <nav className="rail-nav">
      {NAV.map(g => (
        <div className="ngrp" key={g.group}>
          <div className="gt">{g.group}</div>
          {g.items.map(i => {
            const I = i.icon;
            return (
              <button key={i.id} className={cx('nitem focus-ring', route === i.id && 'on')} onClick={() => { go(i.id); onClose && onClose(); }}>
                <span className="ni"><I size={17} /></span>{i.label}
                {i.badge && <span className="nb">{i.badge}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
    <div className="rail-foot">
      <button className="nitem focus-ring" onClick={() => { go('settings'); onClose && onClose(); }} style={route === 'settings' ? { background: 'var(--vio-dim)', color: 'var(--tx)' } : null}>
        <span className="ni"><IcSettings size={17} /></span>Settings
      </button>
      <button className="wchip focus-ring" onClick={() => go('settings')}>
        <span className="wa" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="wn trunc" style={{ display: 'block' }}>{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>
          <span className="wv" style={{ display: 'block' }}>{usd(TOTAL_USD, 0)}</span>
        </span>
        <span style={{ color: 'var(--tx4)' }}><IcArrow size={14} /></span>
      </button>
    </div>
  </aside>
);

const Top = ({ route, onMenu, priv, setPriv }) => {
  const [t, x] = TITLES[route] || ['', ''];
  return (
    <header className="top">
      <button className="btn btn-icon mtop focus-ring" onClick={onMenu} aria-label="Menu"><IcMenu size={19} /></button>
      <div className="tl"><div className="tt">{t}</div><div className="tx">{x}</div></div>
      <div className="tr">
        <button className={cx('netchip focus-ring')} onClick={() => setPriv(!priv)} title="Toggle privacy mode"
          style={priv ? { borderColor: 'var(--vio-line)', background: 'var(--vio-dim)', color: 'var(--vio-lift)' } : null}>
          {priv ? <IcEye size={14} /> : <IcEyeOff size={14} />}<span className="nl">{priv ? 'Values shown' : 'Values hidden'}</span>
        </button>
        <span className="netchip"><span className="nd pulse-dot" /><span className="nl">Robinhood Chain</span></span>
      </div>
    </header>
  );
};

const MobileTabs = ({ route, go }) => {
  const items = [
    { id: 'portfolio', label: 'Portfolio', icon: IcPortfolio },
    { id: 'swap', label: 'Swap', icon: IcSwap },
    { id: 'vault', label: 'Vault', icon: IcVault },
    { id: 'agent', label: 'Agent', icon: IcAgent },
    { id: 'settings', label: 'More', icon: IcSettings },
  ];
  return (
    <nav className="mtabs">
      {items.map(i => { const I = i.icon; return (
        <button key={i.id} className={cx('mtab', route === i.id && 'on')} onClick={() => go(i.id)}><I size={19} />{i.label}</button>
      ); })}
    </nav>
  );
};

// masks a value string when privacy mode hides numbers
const Mask = ({ show, children }) => show ? children : <span style={{ letterSpacing: '.08em' }}>••••••</span>;

Object.assign(window, { NAV, TITLES, Rail, Top, MobileTabs, Mask });
