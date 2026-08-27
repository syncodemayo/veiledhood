// VeiledHood — private screens: data, agent, mcp, payments
const { useState: pS, useRef: pR, useEffect: pE } = React;

/* ── ENCRYPTED DATA ─────────────────────────── */
const DataVault = ({ ctx }) => {
  const [recs, setRecs] = pS(RECORDS);
  const [q, setQ] = pS('');
  const [empty, setEmpty] = pS(false);
  const list = (empty ? [] : recs).filter(r => !q || r.label.toLowerCase().includes(q.toLowerCase()) || r.tags.some(t => t.includes(q.toLowerCase())));

  return (
    <div className="wrap fade-in" style={{ maxWidth: 900 }}>
      <div className="g3">
        <div className="panel panel-b"><Stat label="Records" value={empty ? '0' : String(recs.length)} sub="all ciphertext" size={26} /></div>
        <div className="panel panel-b"><Stat label="Stored" value={empty ? '0 KB' : '151 KB'} sub="encrypted at rest" size={26} /></div>
        <div className="panel panel-b" style={{ borderColor: 'var(--vio-line)' }}><Stat label="Key location" value="Device" sub="never transmitted" size={26} mono={false} /></div>
      </div>

      <div className="pbar">
        <span style={{ color: 'var(--vio-lift)' }}><IcLock size={18} /></span>
        <span className="pt">Encrypted before it leaves your device</span>
        <span className="px">VeiledHood stores opaque blobs — it cannot read these</span>
      </div>

      <Panel title="Records" kicker="Encrypted store" pad={false}
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 11px', background: 'var(--p2)', border: '1px solid var(--line)', borderRadius: 'var(--r1)' }}>
            <span style={{ color: 'var(--tx4)', display: 'flex' }}><IcSearch size={14} /></span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tags" style={{ width: 108, fontFamily: 'var(--mono)', fontSize: 11.5 }} />
          </div>
          <Btn kind="pri" size="sm" icon={<IcPlus size={14} />} onClick={() => ctx.confirm({
            title: 'Store encrypted record', kind: 'data',
            rows: [['Encryption', 'AES-256-GCM, local'], ['Key', 'Stays on device'], ['Server sees', 'Ciphertext + size'], ['Searchable by', 'Encrypted tags']],
            cta: 'Encrypt and store', steps: ['Encrypting locally', 'Uploading ciphertext', 'Indexing tags'],
          })}>New</Btn>
        </div>}>
        {list.length === 0 ? (
          <Empty icon={<IcData size={22} />} title={q ? 'No matching records' : 'Nothing stored yet'}
            desc={q ? 'Tags are encrypted, but search still works locally against your own index.' : 'Store strategies, agent memory, configs or research. Everything is encrypted on this device first.'}
            action={q ? <Btn kind="sec" size="sm" onClick={() => setQ('')}>Clear search</Btn> : <Btn kind="pri" size="sm" icon={<IcPlus size={14} />} onClick={() => setEmpty(false)}>Store a record</Btn>} />
        ) : list.map(r => (
          <ListRow key={r.id} icon={<IcLock size={16} />} title={r.label}
            sub={r.tags.map(t => '#' + t).join('  ')} onClick={() => ctx.toast('Decrypted locally', r.label)}
            end={<div className="lend" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Pill tone="vio">Encrypted</Pill>
              <div><div className="lv">{r.size}</div><div className="lx">{r.at}</div></div>
            </div>} />
        ))}
      </Panel>

      {!empty && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEmpty(true)}>Preview empty state →</button>}
    </div>
  );
};

/* ── AGENT ──────────────────────────────────── */
const Agent = ({ ctx }) => {
  const [msgs, setMsgs] = pS(AGENT_MSGS);
  const [val, setVal] = pS('');
  const [busy, setBusy] = pS(false);
  const end = pR(null);
  pE(() => { if (end.current) end.current.parentElement.scrollTop = end.current.parentElement.scrollHeight; }, [msgs, busy]);

  const send = () => {
    if (!val.trim()) return;
    const q = val.trim();
    setMsgs(m => [...m, { role: 'user', text: q }]); setVal(''); setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setMsgs(m => [...m, { role: 'agent', text: 'Answered from your encrypted context — the prompt was sealed before it left this device, and the model provider received no wallet identifiers.' }]);
    }, 1500);
  };

  return (
    <div className="wrap fade-in" style={{ maxWidth: 880 }}>
      <div className="pbar">
        <span style={{ color: 'var(--vio-lift)' }}><IcShield size={18} /></span>
        <span className="pt">Encrypted prompts · routed over Tor</span>
        <Pill tone="vio" dot>0.01 USDC / call</Pill>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 340, maxHeight: 460 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              <span className="lico" style={{ width: 30, height: 30, background: m.role === 'user' ? 'var(--p3)' : 'var(--vio-dim)', color: m.role === 'user' ? 'var(--tx3)' : 'var(--vio-lift)' }}>
                {m.role === 'user' ? <IcWallet size={15} /> : <Mark size={15} />}
              </span>
              <div style={{
                maxWidth: '76%', padding: '12px 15px', borderRadius: 'var(--r3)', fontSize: 13.5, lineHeight: 1.58, letterSpacing: '-.01em',
                background: m.role === 'user' ? 'var(--p3)' : 'var(--p2)',
                border: '1px solid ' + (m.role === 'user' ? 'var(--line2)' : 'var(--vio-line)'),
                borderTopRightRadius: m.role === 'user' ? 4 : undefined, borderTopLeftRadius: m.role === 'user' ? undefined : 4,
              }}>{m.text}</div>
            </div>
          ))}
          {busy && (
            <div style={{ display: 'flex', gap: 12 }}>
              <span className="lico" style={{ width: 30, height: 30, background: 'var(--vio-dim)', color: 'var(--vio-lift)' }}><Mark size={15} /></span>
              <div style={{ padding: '14px 15px', borderRadius: 'var(--r3)', borderTopLeftRadius: 4, background: 'var(--p2)', border: '1px solid var(--vio-line)', display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="spin" style={{ width: 13, height: 13, border: '1.6px solid var(--vio-lift)', borderTopColor: 'transparent', borderRadius: '50%' }} />
                <span className="lbl" style={{ fontSize: 9.5 }}>Sealing prompt · paying · inferring</span>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flex: '0 0 auto' }}>
          <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Ask about your portfolio, a strategy, a wallet question…"
            style={{ flex: 1, height: 44, padding: '0 14px', background: 'var(--p2)', border: '1px solid var(--line)', borderRadius: 'var(--r2)', fontSize: 13.5 }} />
          <Btn kind="pri" onClick={send} disabled={!val.trim() || busy} icon={<IcArrow size={16} />}>Send</Btn>
        </div>
      </div>

      <div className="g3">
        <div className="panel panel-b"><Stat label="Calls today" value="128" sub="0.01 USDC each" size={22} /></div>
        <div className="panel panel-b"><Stat label="Spend today" value="$1.28" sub="settled on stealth addrs" size={22} /></div>
        <div className="panel panel-b"><Stat label="Prompts leaked" value="0" sub="sealed end to end" size={22} /></div>
      </div>
    </div>
  );
};

/* ── MCP ────────────────────────────────────── */
const Mcp = ({ ctx }) => {
  const [clients, setClients] = pS(CLIENTS);
  const [copied, setCopied] = pS(false);
  const cfg = `{
  "mcpServers": {
    "veiledhood": {
      "command": "npx",
      "args": ["-y", "@veiledhood/mcp"],
      "env": { "VH_VIEWING_KEY": "vk_live_••••••••" }
    }
  }
}`;
  const tools = ['wallet_context', 'private_swap', 'vault_deposit', 'data_store', 'data_search', 'pay_service'];

  return (
    <div className="wrap fade-in" style={{ maxWidth: 900 }}>
      <div className="pbar">
        <span style={{ color: 'var(--vio-lift)' }}><IcMcp size={18} /></span>
        <span className="pt">Agents get tools — never your plaintext config</span>
        <span className="px">Viewing key stays on this device</span>
      </div>

      <div className="g2">
        <Panel title="Connect a client" kicker="Setup"
          action={<Btn kind="sec" size="sm" icon={<IcCopy size={14} />} onClick={() => { setCopied(true); ctx.toast('Config copied'); setTimeout(() => setCopied(false), 1600); }}>{copied ? 'Copied' : 'Copy'}</Btn>}>
          <pre style={{ margin: 0, padding: 14, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 'var(--r2)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.65, color: 'var(--tx2)', overflowX: 'auto' }}>{cfg}</pre>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--tx3)', lineHeight: 1.6, marginTop: 12 }}>
            Drop this into your client's MCP config. The key is scoped to reads and revocable from Settings.
          </div>
        </Panel>

        <Panel title="Exposed tools" kicker={`${tools.length} available`} pad={false}>
          {tools.map(t => (
            <ListRow key={t} icon={<IcLock size={15} />} title={<span className="num" style={{ fontSize: 12.5 }}>{t}</span>}
              end={<Pill tone="vio">Private</Pill>} />
          ))}
        </Panel>
      </div>

      <Panel title="Connected clients" kicker="Sessions" pad={false}>
        {clients.map(c => (
          <ListRow key={c.id} icon={<IcAgent size={16} />} title={c.name}
            sub={c.status === 'off' ? 'Not connected' : `${c.tools} tools · ${c.last}`}
            end={<div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Pill tone={c.status === 'connected' ? 'pos' : c.status === 'idle' ? 'warn' : 'mute'} dot={c.status !== 'off'}>
                {c.status === 'connected' ? 'Live' : c.status === 'idle' ? 'Idle' : 'Off'}
              </Pill>
              <Btn kind={c.status === 'off' ? 'pri' : 'sec'} size="sm"
                onClick={() => { setClients(cs => cs.map(x => x.id === c.id ? { ...x, status: x.status === 'off' ? 'connected' : 'off', tools: x.status === 'off' ? 6 : 0, last: x.status === 'off' ? 'Active now' : 'Just now' } : x)); ctx.toast(c.status === 'off' ? 'Client connected' : 'Client revoked', c.name); }}>
                {c.status === 'off' ? 'Connect' : 'Revoke'}
              </Btn>
            </div>} />
        ))}
      </Panel>
    </div>
  );
};

/* ── PAYMENTS ───────────────────────────────── */
const Payments = ({ ctx }) => {
  const M = v => <Mask show={ctx.priv}>{v}</Mask>;
  const spend = SERVICES.reduce((s, x) => s + x.spend, 0);
  const calls = SERVICES.reduce((s, x) => s + x.calls, 0);
  return (
    <div className="wrap fade-in" style={{ maxWidth: 940 }}>
      <div className="g4">
        <div className="panel panel-b"><Stat label="Spend (30d)" value={M(usd(spend))} sub="USDC" size={24} /></div>
        <div className="panel panel-b"><Stat label="Calls (30d)" value={M(calls.toLocaleString())} sub="pay-per-request" size={24} /></div>
        <div className="panel panel-b"><Stat label="Avg / call" value={M('$0.0058')} sub="model-specific" size={24} /></div>
        <div className="panel panel-b" style={{ borderColor: 'var(--vio-line)' }}><Stat label="Stealth addrs" value={M('4,820')} sub="one per payment" size={24} /></div>
      </div>

      <div className="pbar">
        <span style={{ color: 'var(--vio-lift)' }}><IcLock size={18} /></span>
        <span className="pt">Every payment lands on a fresh stealth address</span>
        <span className="px">No recurring recipient for observers to cluster</span>
      </div>

      <div className="g2">
        <Panel title="Services" kicker="Priced per call" pad={false}>
          {SERVICES.map(s => (
            <ListRow key={s.id} icon={<IcPay size={16} />} title={s.name} sub={`${s.calls.toLocaleString()} calls`}
              end={<div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ textAlign: 'right' }}><div className="lv vio">{'$' + s.price.toFixed(3)}</div><div className="lx">per call</div></div>
                <div style={{ textAlign: 'right', minWidth: 62 }}><div className="lv">{M(usd(s.spend))}</div><div className="lx">30d</div></div>
              </div>} />
          ))}
        </Panel>

        <Panel title="Settlement stream" kicker="Live" pad={false}
          action={<Pill tone="pos" dot>Streaming</Pill>}>
          {PAYMENTS.map(p => (
            <ListRow key={p.id} icon={<IcLock size={15} />}
              title={<span className="num" style={{ fontSize: 12.5, color: 'var(--vio-lift)' }}>{p.to}</span>}
              sub={p.svc}
              end={<div style={{ textAlign: 'right' }}><div className="lv">−{p.amt.toFixed(3)}</div><div className="lx">USDC · {p.at}</div></div>} />
          ))}
        </Panel>
      </div>

      <Panel title="Call volume" kicker="Last 14 days">
        <Bars data={[38, 42, 51, 47, 62, 58, 71, 66, 78, 84, 79, 92, 101, 128]} h={64} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--tx4)', marginTop: 10 }}>
          <span>14d ago</span><span>Today · 128 calls</span>
        </div>
      </Panel>
    </div>
  );
};

Object.assign(window, { DataVault, Agent, Mcp, Payments });
