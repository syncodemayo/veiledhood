// VeiledHood — trade screens: swap, bridge, vault
const { useState: tS } = React;

/* ── SWAP ───────────────────────────────────── */
const Swap = ({ ctx }) => {
  const [from, setFrom] = tS('2.4');
  const [fTok, setFTok] = tS('vETH');
  const [tTok, setTTok] = tS('vUSD');
  const [priv, setPriv] = tS(true);
  const [newAddr, setNewAddr] = tS(true);
  const f = TOKENS[fTok], t = TOKENS[tTok];
  const amt = parseFloat(from) || 0;
  const out = amt * f.px / t.px * 0.9993;
  const flip = () => { setFTok(tTok); setTTok(fTok); setFrom(out ? out.toFixed(4) : ''); };

  return (
    <div className="wrap-n fade-in">
      <div className="panel" style={{ padding: 16 }}>
        <AssetInput label="You pay" value={from} onChange={setFrom} token={f} balance={BALANCES[fTok]}
          usdValue={amt * f.px} onMax={() => setFrom(String(BALANCES[fTok]))} />
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-9px 0', position: 'relative', zIndex: 2 }}>
          <button className="focus-ring" onClick={flip} style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--p3)', border: '3px solid var(--p1)', color: 'var(--vio-lift)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IcDown size={16} />
          </button>
        </div>
        <AssetInput label="You receive" value={out ? out.toFixed(t.px === 1 ? 2 : 4) : ''} token={t} readOnly usdValue={out * t.px} />

        <div className="pbar" style={{ marginTop: 14 }}>
          <span style={{ color: priv ? 'var(--vio-lift)' : 'var(--tx4)' }}><IcShield size={18} /></span>
          <span className="pt">Private route</span>
          <Toggle on={priv} onChange={setPriv} />
        </div>

        <div style={{ padding: '6px 2px 0' }}>
          <DRow k="Rate" v={`1 ${f.sym} = ${fmt(f.px / t.px, t.px === 1 ? 2 : 6)} ${t.sym}`} />
          <DRow k="Price impact" v="0.04%" tone="pos" />
          <DRow k="Route" v={priv ? 'Shielded pool' : 'Public AMM'} tone={priv ? 'vio' : ''} />
          <DRow k="Network fee" v="~$0.02" />
          <DRow k="Min received" v={`${fmt(out * 0.995, t.px === 1 ? 2 : 4)} ${t.sym}`} hint="After 0.5% slippage tolerance" />
        </div>

        {priv && (
          <>
            <div className="hair" style={{ margin: '14px 0 4px' }} />
            <div className="tgrow" style={{ padding: '10px 0' }}>
              <div style={{ flex: 1 }}>
                <div className="tt">Send output to a fresh address</div>
                <div className="tx">Breaks the link between the wallet that opened the trade and the one that receives it.</div>
              </div>
              <Toggle on={newAddr} onChange={setNewAddr} />
            </div>
            {newAddr && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 'var(--r2)', background: 'var(--vio-dim)', border: '1px solid var(--vio-line)' }}>
                <span style={{ color: 'var(--vio-lift)' }}><IcLock size={14} /></span>
                <span className="num" style={{ fontSize: 11.5, color: 'var(--vio-lift)', flex: 1 }}>0x3fB1…a07E</span>
                <span className="lbl" style={{ fontSize: 8.5 }}>One-time</span>
              </div>
            )}
          </>
        )}

        <Btn kind="pri" size="lg" block disabled={!amt} className="focus-ring" style={{ marginTop: 16 }}
          onClick={() => ctx.confirm({
            title: priv ? 'Confirm private swap' : 'Confirm swap', kind: 'swap',
            rows: [['You pay', `${fmt(amt, 4)} ${f.sym}`], ['You receive', `${fmt(out, t.px === 1 ? 2 : 4)} ${t.sym}`],
              ['Route', priv ? 'Shielded pool' : 'Public AMM'], ['Recipient', priv && newAddr ? '0x3fB1…a07E (one-time)' : 'This wallet'],
              ['Price impact', '0.04%'], ['Network fee', '~$0.02']],
            cta: priv ? 'Swap privately' : 'Swap',
            steps: priv ? ['Building shielded note', 'Proving membership', 'Submitting to pool', 'Settling on Robinhood Chain'] : ['Approving', 'Submitting', 'Settling'],
          })}>
          {amt ? (priv ? 'Swap privately' : 'Swap') : 'Enter an amount'}
        </Btn>
      </div>

      <Panel title="Why this is private" kicker="Under the hood">
        <DRow k="Amounts" v="Hidden in pool" tone="vio" />
        <DRow k="Sender" v="Unlinked" tone="vio" />
        <DRow k="Recipient" v={newAddr ? 'Fresh address' : 'Reused'} tone={newAddr ? 'vio' : 'neg'} />
        <DRow k="Timing" v="Jittered" tone="vio" />
      </Panel>
    </div>
  );
};

/* ── BRIDGE ─────────────────────────────────── */
const CHAINS = [
  { id: 'eth', name: 'Ethereum', dot: '#5B7BE8' },
  { id: 'rh', name: 'Robinhood Chain', dot: '#3FD98B' },
  { id: 'base', name: 'Base', dot: '#2775CA' },
];

const Bridge = ({ ctx }) => {
  const [amt, setAmt] = tS('12000');
  const [tok, setTok] = tS('USDC');
  const [src, setSrc] = tS('eth');
  const [dst, setDst] = tS('rh');
  const [shield, setShield] = tS(true);
  const t = TOKENS[tok], n = parseFloat(amt) || 0;
  const S = CHAINS.find(c => c.id === src), D = CHAINS.find(c => c.id === dst);
  const ChainPick = ({ label, val, onPick }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="lbl" style={{ marginBottom: 8 }}>{label}</div>
      <select value={val} onChange={e => onPick(e.target.value)}
        style={{ width: '100%', height: 44, background: 'var(--p2)', border: '1px solid var(--line)', borderRadius: 'var(--r2)', color: 'var(--tx)', fontFamily: 'var(--sans)', fontSize: 13.5, fontWeight: 600, padding: '0 12px', appearance: 'none' }}>
        {CHAINS.map(c => <option key={c.id} value={c.id} style={{ background: '#14151C' }}>{c.name}</option>)}
      </select>
    </div>
  );

  return (
    <div className="wrap-n fade-in">
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <ChainPick label="From" val={src} onPick={setSrc} />
          <button className="focus-ring" onClick={() => { setSrc(dst); setDst(src); }}
            style={{ width: 44, height: 44, borderRadius: 'var(--r2)', background: 'var(--p3)', border: '1px solid var(--line2)', color: 'var(--vio-lift)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
            <IcSwap size={17} />
          </button>
          <ChainPick label="To" val={dst} onPick={setDst} />
        </div>

        <div style={{ marginTop: 16 }}>
          <AssetInput label="Amount" value={amt} onChange={setAmt} token={t} balance={BALANCES[tok]} usdValue={n * t.px} onMax={() => setAmt(String(BALANCES[tok]))} />
        </div>

        <div className="pbar" style={{ marginTop: 14 }}>
          <span style={{ color: shield ? 'var(--vio-lift)' : 'var(--tx4)' }}><IcShield size={18} /></span>
          <span className="pt">Arrive shielded</span>
          <Toggle on={shield} onChange={setShield} />
        </div>

        <div style={{ padding: '6px 2px 0' }}>
          <DRow k="You receive" v={`${fmt(n * 0.9994, 2)} ${shield ? 'v' + (tok === 'USDC' ? 'USD' : tok) : tok}`} />
          <DRow k="Bridge fee" v="0.06%" />
          <DRow k="Est. time" v={shield ? '~4 min' : '~2 min'} />
          <DRow k="Destination" v={shield ? 'Shielded pool' : 'Public balance'} tone={shield ? 'vio' : ''} />
        </div>

        <Btn kind="pri" size="lg" block disabled={!n || src === dst} className="focus-ring" style={{ marginTop: 16 }}
          onClick={() => ctx.confirm({
            title: 'Confirm bridge', kind: 'bridge',
            rows: [['Amount', `${fmt(n, 2)} ${tok}`], ['From', S.name], ['To', D.name],
              ['Arrives as', shield ? 'Shielded' : 'Public'], ['Bridge fee', '0.06%'], ['Est. time', shield ? '~4 min' : '~2 min']],
            cta: 'Bridge ' + tok,
            steps: ['Locking on ' + S.name, 'Waiting for attestation', shield ? 'Minting shielded note' : 'Releasing on ' + D.name, 'Done'],
          })}>
          {src === dst ? 'Pick two different chains' : n ? 'Bridge ' + tok : 'Enter an amount'}
        </Btn>
      </div>

      <Panel title="In flight" kicker="Transfers" pad={false}>
        <Empty icon={<IcBridge size={22} />} title="Nothing in flight" desc="Bridge transfers in progress will show up here with live attestation status." />
      </Panel>
    </div>
  );
};

/* ── VAULT ──────────────────────────────────── */
const Vault = ({ ctx }) => {
  const [mode, setMode] = tS('deposit');
  const [amt, setAmt] = tS('5');
  const dep = mode === 'deposit';
  const tok = dep ? TOKENS.ETH : TOKENS.vETH;
  const outTok = dep ? TOKENS.vETH : TOKENS.ETH;
  const n = parseFloat(amt) || 0;
  const M = v => <Mask show={ctx.priv}>{v}</Mask>;

  return (
    <div className="wrap-n fade-in">
      <div className="g2" style={{ gap: 12 }}>
        <div className="panel panel-b" style={{ borderColor: 'var(--vio-line)', background: 'linear-gradient(160deg,var(--p1),rgba(130,87,255,.06))' }}>
          <Stat label="Shielded" value={M(fmt(BALANCES.vETH, 3))} sub="vETH" size={24} />
        </div>
        <div className="panel panel-b"><Stat label="Public" value={M(fmt(BALANCES.ETH, 3))} sub="ETH" size={24} /></div>
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <Tabs items={[{ id: 'deposit', label: 'Deposit' }, { id: 'withdraw', label: 'Withdraw' }]} active={mode} onChange={setMode} />
        </div>

        <AssetInput label={dep ? 'Deposit to shield' : 'Withdraw to reveal'} value={amt} onChange={setAmt}
          token={tok} balance={dep ? BALANCES.ETH : BALANCES.vETH} usdValue={n * tok.px} onMax={() => setAmt(String(dep ? BALANCES.ETH : BALANCES.vETH))} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 4px' }}>
          <span style={{ color: 'var(--vio-lift)', display: 'flex' }}>{dep ? <IcLock size={17} /> : <IcEye size={17} />}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--tx3)', lineHeight: 1.55 }}>
            {dep ? 'Your deposit becomes a shielded note. Amounts and history stop being publicly readable.'
                 : 'Withdrawing publishes an amount on-chain. Send to a fresh address to avoid rebuilding the link.'}
          </span>
        </div>

        <div className="ai" style={{ background: 'var(--p1)', borderStyle: 'dashed' }}>
          <div className="ai-top"><span className="lbl">You get</span></div>
          <div className="ai-row">
            <span className="ai-in" style={{ color: n ? 'var(--tx)' : 'var(--tx4)' }}>{n ? fmt(n * 0.9998, 4) : '0.00'}</span>
            <span className="tokbtn" style={{ cursor: 'default' }}><TokDot sym={outTok.sym} color={outTok.color} />{outTok.sym}</span>
          </div>
        </div>

        <div style={{ padding: '10px 2px 0' }}>
          <DRow k="Protocol fee" v="0.02%" />
          <DRow k={dep ? 'Anonymity set' : 'Reveals'} v={dep ? '24,180 notes' : 'Amount only'} tone={dep ? 'vio' : 'warn'} />
          <DRow k="Est. time" v="~40 sec" />
        </div>

        <Btn kind="pri" size="lg" block disabled={!n} className="focus-ring" style={{ marginTop: 16 }}
          onClick={() => ctx.confirm({
            title: dep ? 'Confirm deposit' : 'Confirm withdrawal', kind: 'vault',
            rows: [[dep ? 'Depositing' : 'Withdrawing', `${fmt(n, 4)} ${tok.sym}`], ['You get', `${fmt(n * 0.9998, 4)} ${outTok.sym}`],
              [dep ? 'Anonymity set' : 'Reveals', dep ? '24,180 notes' : 'Amount only'], ['Protocol fee', '0.02%']],
            cta: dep ? 'Deposit and shield' : 'Withdraw',
            steps: dep ? ['Building note', 'Committing to Merkle tree', 'Confirming'] : ['Generating proof', 'Spending nullifier', 'Releasing funds'],
          })}>
          {n ? (dep ? 'Deposit and shield' : 'Withdraw') : 'Enter an amount'}
        </Btn>
      </div>
    </div>
  );
};

Object.assign(window, { Swap, Bridge, Vault, CHAINS });
