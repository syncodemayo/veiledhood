// VeiledHood — core screens: onboarding, portfolio, staking, settings
const { useState: uS, useEffect: uE } = React;

/* ── ONBOARDING ─────────────────────────────── */
const Onboarding = ({ onDone }) => {
  const [step, setStep] = uS(0);
  const [connecting, setConnecting] = uS(null);
  const wallets = [
    { id: 'rh', name: 'Robinhood Wallet', sub: 'Native to the chain', rec: true },
    { id: 'mm', name: 'MetaMask', sub: 'Browser extension' },
    { id: 'wc', name: 'WalletConnect', sub: 'Scan to connect' },
  ];
  const connect = (id) => { setConnecting(id); setTimeout(() => { setConnecting(null); setStep(1); }, 1100); };

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 428 }} className="fade-in">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 30 }}>
          <span style={{ color: 'var(--vio-lift)', filter: 'drop-shadow(0 0 26px var(--vio-glow))' }}><Mark size={62} /></span>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.038em', margin: '20px 0 0' }}>Veiled<span style={{ color: 'var(--vio-lift)' }}>Hood</span></h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--tx3)', lineHeight: 1.6, margin: '11px 0 0', maxWidth: 320 }}>
            {step === 0 ? 'Private swaps, shielded balances and agent-native tooling on Robinhood Chain.' : 'One more step — set your privacy default.'}
          </p>
        </div>

        {step === 0 ? (
          <div className="panel" style={{ padding: 10 }}>
            {wallets.map(w => (
              <button key={w.id} className="lrow hov" onClick={() => connect(w.id)} disabled={!!connecting}
                style={{ width: '100%', textAlign: 'left', borderRadius: 'var(--r2)', borderBottom: 0 }}>
                <span className="lico"><IcWallet size={17} /></span>
                <span className="lmain">
                  <span className="lt" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{w.name}{w.rec && <Pill tone="vio">Recommended</Pill>}</span>
                  <span className="lx" style={{ display: 'block' }}>{w.sub}</span>
                </span>
                {connecting === w.id
                  ? <span className="spin" style={{ width: 15, height: 15, border: '1.7px solid var(--vio-lift)', borderTopColor: 'transparent', borderRadius: '50%' }} />
                  : <span style={{ color: 'var(--tx4)' }}><IcArrow size={16} /></span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="panel panel-b">
            <div className="pbar" style={{ marginBottom: 6 }}>
              <span style={{ color: 'var(--vio-lift)' }}><IcShield size={18} /></span>
              <span className="pt">Shield by default</span>
              <Pill tone="vio" dot>On</Pill>
            </div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--tx3)', lineHeight: 1.65, margin: '14px 0 4px' }}>
              New deposits route into the shielded pool, swaps execute privately, and balance reads are batched with decoys. You can change any of this in Settings.
            </p>
            <div className="hair" style={{ margin: '16px 0' }} />
            <DRow k="Wallet" v="0x7eA4…D29c" />
            <DRow k="Network" v="Robinhood Chain" />
            <DRow k="Shielded pool" v="Live" tone="pos" />
            <Btn kind="pri" size="lg" block onClick={onDone} className="focus-ring" style={{ marginTop: 18 }}>Enter VeiledHood</Btn>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginTop: 22 }}>
          {[0, 1].map(i => <span key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 100, background: i === step ? 'var(--vio)' : 'var(--p4)', transition: 'all .2s' }} />)}
        </div>
      </div>
    </div>
  );
};

/* ── PORTFOLIO ──────────────────────────────── */
const Portfolio = ({ ctx }) => {
  const [loading, setLoading] = uS(true);
  const [range, setRange] = uS('30d');
  uE(() => { const t = setTimeout(() => setLoading(false), 900); return () => clearTimeout(t); }, []);
  const shPct = Math.round((SHIELDED_USD / TOTAL_USD) * 100);
  const M = v => <Mask show={ctx.priv}>{v}</Mask>;

  if (loading) return (
    <div className="wrap">
      <div className="g4">{[0, 1, 2, 3].map(i => (
        <div className="panel panel-b" key={i}><Sk w="52%" h={9} /><Sk w="78%" h={26} style={{ marginTop: 16 }} /><Sk w="40%" h={9} style={{ marginTop: 14 }} /></div>
      ))}</div>
      <div className="g2"><div className="panel panel-b" style={{ height: 268 }}><Sk w="34%" h={11} /><Sk w="100%" h={190} r={10} style={{ marginTop: 20 }} /></div>
        <div className="panel panel-b" style={{ height: 268 }}><Sk w="30%" h={11} />{[0, 1, 2, 3].map(i => <Sk key={i} w="100%" h={38} r={8} style={{ marginTop: 12 }} />)}</div></div>
    </div>
  );

  return (
    <div className="wrap fade-in">
      <div className="g4">
        <div className="panel panel-b"><Stat label="Total value" value={M(usd(TOTAL_USD, 0))} delta={4.28} sub="30d" /></div>
        <div className="panel panel-b" style={{ borderColor: 'var(--vio-line)', background: 'linear-gradient(160deg,var(--p1),rgba(130,87,255,.06))' }}>
          <Stat label="Shielded" value={M(usd(SHIELDED_USD, 0))} delta={6.91} sub={`${shPct}% of total`} />
        </div>
        <div className="panel panel-b"><Stat label="Public" value={M(usd(PUBLIC_USD, 0))} delta={-1.14} sub={`${100 - shPct}% of total`} /></div>
        <div className="panel panel-b"><Stat label="Privacy score" value="A−" sub="2 exposures to fix" mono={false} /></div>
      </div>

      <div className="g2">
        <Panel title="Shielded value" kicker="Performance" action={<Tabs items={[{ id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: 'all', label: 'All' }]} active={range} onChange={setRange} />}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <span className="num" style={{ fontSize: 27 }}>{M(usd(SHIELDED_USD, 0))}</span>
            <span className="pos" style={{ fontSize: 12.5, fontWeight: 700 }}>+6.91%</span>
          </div>
          <div style={{ margin: '14px -4px 0' }}><Spark data={range === '7d' ? SERIES.slice(-7) : SERIES} w={520} h={132} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--tx4)', marginTop: 10 }}>
            <span>{range === '7d' ? '7 days ago' : '30 days ago'}</span><span>Now</span>
          </div>
        </Panel>

        <Panel title="Shielded vs public" kicker="Composition">
          <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            <div style={{ position: 'relative', flex: '0 0 auto' }}>
              <Ring pct={shPct} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="num" style={{ fontSize: 24 }}>{shPct}%</span>
                <span className="lbl" style={{ fontSize: 8.5, marginTop: 3 }}>Shielded</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {HOLDINGS.map(h => {
                const t = TOKENS[h.sym], v = h.amt * t.px;
                return (
                  <div key={h.sym} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <TokDot sym={t.sym} color={t.color} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{t.sym}{h.shielded && <span style={{ color: 'var(--vio-lift)', display: 'flex' }}><IcLock size={11} /></span>}</span>
                    </span>
                    <span className="num" style={{ fontSize: 12 }}>{M(usd(v, 0))}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Activity" kicker="Recent" pad={false}
        action={<Btn kind="ghost" size="sm" icon={<IcHistory size={14} />}>View all</Btn>}>
        {ACTIVITY.map(a => (
          <ListRow key={a.id}
            icon={a.kind === 'swap' ? <IcSwap size={16} /> : a.kind === 'vault' ? <IcVault size={16} /> : a.kind === 'bridge' ? <IcBridge size={16} /> : a.kind === 'stake' ? <IcStake size={16} /> : <IcPay size={16} />}
            title={a.title} sub={a.sub}
            end={<div className="lend" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {a.priv && <Pill tone="vio">Private</Pill>}
              <div><div className={cx('lv', a.tone)}>{M(a.val)}</div><div className="lx">{a.unit} · {a.at}</div></div>
            </div>} />
        ))}
      </Panel>
    </div>
  );
};

/* ── STAKING ────────────────────────────────── */
const Staking = ({ ctx }) => {
  const staked = POOLS.reduce((s, p) => s + p.staked * TOKENS[p.sym].px, 0);
  const M = v => <Mask show={ctx.priv}>{v}</Mask>;
  return (
    <div className="wrap fade-in">
      <div className="g3">
        <div className="panel panel-b"><Stat label="Staked value" value={M(usd(staked, 0))} sub="across 2 pools" /></div>
        <div className="panel panel-b"><Stat label="Unclaimed" value={M('18.42')} sub="HOOD · epoch 1,284" /></div>
        <div className="panel panel-b" style={{ borderColor: 'var(--vio-line)' }}><Stat label="Blended APR" value="6.34%" sub="rewards accrue shielded" /></div>
      </div>

      <div className="pbar">
        <span style={{ color: 'var(--vio-lift)' }}><IcShield size={18} /></span>
        <span className="pt">Rewards accrue inside the shielded pool</span>
        <span className="px">No claim event links your positions</span>
      </div>

      <Panel title="Pools" kicker="Earn" pad={false}>
        {POOLS.map(p => (
          <ListRow key={p.id} icon={<TokDot sym={p.sym} color={TOKENS[p.sym].color} />}
            title={p.name} sub={`TVL ${p.tvl}`}
            end={<div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ textAlign: 'right' }}><div className="lv pos">{fmt(p.apr)}%</div><div className="lx">APR</div></div>
              <div style={{ textAlign: 'right', minWidth: 92 }}><div className="lv">{p.staked ? M(fmt(p.staked, p.sym === 'vUSD' ? 0 : 3)) : '—'}</div><div className="lx">Your stake</div></div>
              <Btn kind={p.staked ? 'sec' : 'pri'} size="sm" onClick={() => ctx.confirm({
                title: p.staked ? 'Manage stake' : 'Stake ' + p.sym, kind: 'stake',
                rows: [['Pool', p.name], ['APR', fmt(p.apr) + '%'], ['Reward routing', 'Shielded'], ['Lockup', 'None']],
                cta: p.staked ? 'Add to stake' : 'Stake ' + p.sym,
              })}>{p.staked ? 'Manage' : 'Stake'}</Btn>
            </div>} />
        ))}
      </Panel>
    </div>
  );
};

/* ── SETTINGS ───────────────────────────────── */
const Settings = ({ ctx }) => {
  const [s, setS] = uS({ shield: true, decoy: true, jitter: true, mask: false, tor: true, auto: false });
  const set = k => v => setS(p => ({ ...p, [k]: v }));
  return (
    <div className="wrap fade-in" style={{ maxWidth: 760 }}>
      <Panel title="Privacy defaults" kicker="Protocol">
        <ToggleRow icon={<IcShield size={16} />} title="Shield by default" desc="Route new deposits into the shielded pool automatically." on={s.shield} onChange={set('shield')} />
        <div className="hair" />
        <ToggleRow icon={<IcEyeOff size={16} />} title="Decoy reads" desc="Pad every balance query with plausible sibling reads." on={s.decoy} onChange={set('decoy')} />
        <div className="hair" />
        <ToggleRow icon={<IcHistory size={16} />} title="Timing jitter" desc="Randomise request timing so reads can't be correlated." on={s.jitter} onChange={set('jitter')} />
        <div className="hair" />
        <ToggleRow icon={<IcMcp size={16} />} title="Route over Tor" desc="Send inference and RPC traffic through Tor." on={s.tor} onChange={set('tor')} />
      </Panel>

      <Panel title="Interface" kicker="This device">
        <ToggleRow icon={<IcEye size={16} />} title="Hide values by default" desc="Start every session with balances masked." on={s.mask} onChange={set('mask')} />
        <div className="hair" />
        <ToggleRow icon={<IcSpark size={16} />} title="Auto-shield incoming" desc="Shield anything that lands in the public balance." on={s.auto} onChange={set('auto')} />
      </Panel>

      <Panel title="Wallet" kicker="Connected">
        <DRow k="Address" v="0x7eA4…D29c" />
        <DRow k="Network" v="Robinhood Chain" />
        <DRow k="Viewing key" v="Local only · never transmitted" tone="vio" />
        <DRow k="Shielded pool" v="Live" tone="pos" />
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Btn kind="sec" icon={<IcCopy size={15} />} onClick={() => ctx.toast('Address copied')}>Copy address</Btn>
          <Btn kind="ghost" onClick={() => ctx.toast('Viewing key exported')}>Export viewing key</Btn>
        </div>
      </Panel>
    </div>
  );
};

Object.assign(window, { Onboarding, Portfolio, Staking, Settings });
