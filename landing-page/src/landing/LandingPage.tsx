import { useEffect, useState } from "react";
import { useRevealObserver } from "./hooks";
import { Count } from "./Count";
import { Mark, IcSwap, IcVault, IcBridge, IcData, IcAgent, IcMcp, IcPay, IcStake, IcShield, IcLock, IcSpark, IcAlert, IcHistory } from "../components/icons/Icons";
import { Btn } from "../components/primitives/primitives";

const APP_URL = import.meta.env.VITE_APP_URL ?? "http://localhost:5555";

const PROBLEMS = [
  { t: "Who you are", x: "Your address links every transaction back to a single identity anyone can trace." },
  { t: "What you hold", x: "Balances are public — anyone can see exactly what you own, at any moment." },
  { t: "What you did next", x: "Transaction graphs expose your counterparties and behavior patterns over time." },
  { t: "When you act", x: "Timing analysis reveals your habits, even without knowing the amounts." },
];

const FEATURES = [
  { i: IcSwap, t: "Private swap", x: "Trade without publishing the trail — routes never reveal your position size.", m: "Live on testnet" },
  { i: IcVault, t: "Shielded vault", x: "Deposit to shield, withdraw to reveal — Merkle-proof balances, not plaintext.", m: "Live" },
  { i: IcBridge, t: "Bridge", x: "Move value in and out of the shielded pool across chains.", m: "Coming soon" },
  { i: IcAgent, t: "Wallet context", x: "Give agents your real portfolio context without giving them your keys.", m: "Live" },
  { i: IcStake, t: "Staking", x: "Earn on shielded positions without exposing your stake size.", m: "Coming soon" },
  { i: IcData, t: "Encrypted data", x: "Ciphertext at rest — your key never leaves your device.", m: "Live" },
  { i: IcLock, t: "Private inference", x: "Prompts routed through Tor to a TEE. The model never sees your IP.", m: "Live" },
  { i: IcMcp, t: "MCP server", x: "Expose real tools to agents without exposing plaintext balances.", m: "Live" },
  { i: IcPay, t: "Agent payments", x: "Pay-per-call settlement on stealth addresses via x402.", m: "Configurable" },
];

const ROADMAP = [
  { s: "Shipped", t: "Shielded vault + Merkle withdrawals", x: "Deposit, commit, prove, settle — live on Robinhood Chain Testnet.", tone: "pos" },
  { s: "Shipped", t: "Private inference", x: "Tor-routed prompts through a TEE-backed model.", tone: "pos" },
  { s: "Shipped", t: "Encrypted data + agent storage", x: "Client-encrypted records, server sees ciphertext only.", tone: "pos" },
  { s: "Next", t: "VeilSwap on Robinhood Chain", x: "Contract deploy + liquidity for private swaps.", tone: "vio" },
  { s: "Later", t: "Native bridge + staking", x: "Cross-chain shielded transfers and shielded staking pools.", tone: "mute" },
];

const FAQ = [
  { q: "What chain does this run on?", a: "Robinhood Chain Testnet — an Arbitrum Orbit Layer-2 built on Ethereum, using ETH as the native gas token." },
  { q: "Is my balance actually private?", a: "Shielded balances are committed to a Merkle root on-chain — no one can read your balance from the contract state directly. Withdrawals reveal only the amount withdrawn." },
  { q: "What happens to my prompts to the agent?", a: "They're routed through Tor to the inference provider so your IP is never observed, and prompts/responses are never logged server-side." },
  { q: "Where is my encrypted data stored?", a: "As ciphertext on the API server. The decryption key is derived from a wallet signature and never leaves your browser." },
  { q: "Is this audited?", a: "This is a testnet deployment for development and testing. Do not treat it as audited production infrastructure." },
  { q: "What's not live yet?", a: "Cross-chain bridging, staking, and VeilSwap aren't deployed on this chain yet — see the roadmap below." },
];

export function LandingPage() {
  useRevealObserver();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lp">
      <nav className={`nav${stuck ? " stuck" : ""}`}>
        <div className="container in">
          <span className="lg">
            <span style={{ color: "var(--vio-lift)" }}>
              <Mark size={22} />
            </span>
            <span>
              Veiled<span className="b">Hood</span>
            </span>
          </span>
          <div className="lk">
            <a href="#stack">Product</a>
            <a href="#how">How it works</a>
            <a href="#agents">Agents</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="rt">
            <Btn kind="ghost" size="sm">Docs</Btn>
            <a href={`${APP_URL}`}>
              <Btn kind="pri" size="sm">Launch app</Btn>
            </a>
          </div>
        </div>
      </nav>

      <section className="hero container">
        <div className="in">
          <div>
            <span className="eyebrow">
              <i />
              Live on Robinhood Chain
            </span>
            <h1 className="big rv">
              Private by
              <br />
              <span className="g">construction.</span>
            </h1>
            <p className="lead rv d1">
              VeiledHood is a privacy protocol on Robinhood Chain. Hold shielded balances alongside public ones, swap without publishing a
              traceable trail, and give AI agents real tooling over your positions — without handing over plaintext config or keys.
            </p>
            <div className="cta-row rv d2">
              <a href={`${APP_URL}`}>
                <Btn kind="pri" size="lg">Launch app</Btn>
              </a>
              <a href="#stack">
                <Btn kind="sec" size="lg">See what's live</Btn>
              </a>
            </div>
            <div className="hstats rv d3">
              <div>
                <div className="hv"><Count value={24180} /></div>
                <div className="hl">Notes in pool</div>
              </div>
              <div>
                <div className="hv">$<Count value={4820} format="decimal2" />M</div>
                <div className="hl">Shielded TVL</div>
              </div>
              <div>
                <div className="hv"><Count value={20640} /></div>
                <div className="hl">Agent calls</div>
              </div>
              <div>
                <div className="hv"><Count value={0} /></div>
                <div className="hl">Prompts leaked</div>
              </div>
            </div>
          </div>
          <div className="art rv d2" aria-hidden>
            <div className="orb orb1" />
            <div className="orb orb2" />
            {[94, 74, 54, 34].map((s) => (
              <svg key={s} className="arc" width={s * 4} height={s * 4} viewBox="0 0 100 100" style={{ width: `${s}%`, height: `${s}%` }}>
                <path d="M14 88V52a36 36 0 0 1 72 0v36" fill="none" stroke="currentColor" strokeWidth="6" />
              </svg>
            ))}
            <span className="core">
              <Mark size={64} />
            </span>
          </div>
        </div>
      </section>

      <div className="mq">
        <div className="mq-t">
          {[...FEATURES, ...FEATURES].map((f, i) => (
            <span className="mq-i" key={i}>
              <f.i size={14} />
              {f.t}
            </span>
          ))}
        </div>
      </div>

      <section className="sec container">
        <div className="sec-h rv">
          <div className="sec-k">The problem</div>
          <h2>A public chain publishes more than you think.</h2>
          <p className="sec-x">Every transaction on a transparent chain leaks more than the amount that moved.</p>
        </div>
        <div className="leaks">
          {PROBLEMS.map((p, i) => (
            <div className={`leak rv d${(i % 4) + 1}`} key={p.t}>
              <span className="lk-i"><IcAlert size={18} /></span>
              <div className="lk-t">{p.t}</div>
              <div className="lk-x">{p.x}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="stack" className="sec container">
        <div className="sec-h rv">
          <div className="sec-k">The stack</div>
          <h2>Nine surfaces. One privacy layer.</h2>
        </div>
        <div className="feats">
          {FEATURES.map((f, i) => (
            <div className={`feat rv d${(i % 6) + 1}`} key={f.t}>
              <span className="f-i"><f.i size={20} /></span>
              <div className="f-t">{f.t}</div>
              <div className="f-x">{f.x}</div>
              <div className="f-m"><IcShield size={11} />{f.m}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="sec container">
        <div className="sec-h rv">
          <div className="sec-k">How it works</div>
          <h2>Deposit → Commit → Prove → Settle.</h2>
        </div>
        <div className="pipe rv">
          {["Deposit", "Commit", "Prove", "Settle"].map((t, i) => (
            <div className="pstep" key={t}>
              <div className="pn">{String(i + 1).padStart(2, "0")}</div>
              <div className="pt">{t}</div>
              <div className="px">
                {t === "Deposit" && "Funds move into the vault contract."}
                {t === "Commit" && "A new balance commits to the Merkle root."}
                {t === "Prove" && "Withdrawals prove membership without revealing the tree."}
                {t === "Settle" && "The signed proof settles on-chain."}
              </div>
              <div className="pbar-l" />
            </div>
          ))}
        </div>
      </section>

      <section id="agents" className="sec container">
        <div className="split">
          <div className="rv">
            <div className="sec-k">Agents</div>
            <h2>Real tools. No plaintext.</h2>
            <p className="sec-x">The MCP server gives agents genuine read/write access to your portfolio and encrypted storage — never your keys.</p>
            <div className="chk">
              {["Wallet context without exposing keys", "Encrypted agent strategies, ciphertext at rest", "Private inference routed through Tor", "Pay-per-call settlement via x402"].map((c) => (
                <div className="chk-i" key={c}>
                  <span className="c"><IcShield size={11} /></span>
                  <div>
                    <span className="t">{c}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="term rv d2">
            <div className="term-h">
              <i /><i /><i />
              <span>mcp — veiledhood</span>
            </div>
            <div className="term-b">
              <span className="l"><span className="cm"># context_full</span></span>
              <span className="l"><span className="pr">$</span> <span className="vl">shielded: 4.2 ETH, public: 0.8 ETH</span></span>
              <span className="l"><span className="cm"># agent_run rebalance</span></span>
              <span className="l"><span className="ok">✓ settled — no plaintext leaked</span> <span className="cur" /></span>
            </div>
          </div>
        </div>
      </section>

      <section className="sec container">
        <div className="sec-h rv">
          <div className="sec-k">Architecture</div>
          <h2>Off-chain compute. On-chain settlement.</h2>
        </div>
        <div className="arch2 rv">
          <div className="acol hi">
            <div className="ak">Off-chain</div>
            <div className="at">Private computation</div>
            <div className="al">
              {["Merkle tree construction", "Withdraw-auth signing", "Wallet context aggregation"].map((x) => (
                <div className="ai2" key={x}><i />{x}</div>
              ))}
            </div>
          </div>
          <div className="divider">÷</div>
          <div className="acol">
            <div className="ak">On-chain</div>
            <div className="at">Verifiable settlement</div>
            <div className="al">
              {["Merkle root commits", "Nullifier-guarded withdrawals", "Deposit events, publicly verifiable"].map((x) => (
                <div className="ai2" key={x}><i />{x}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="nums rv" style={{ marginTop: 16 }}>
          <div className="nm"><div className="v"><Count value={24180} /></div><div className="l">Anonymity set</div></div>
          <div className="nm"><div className="v">0.04%</div><div className="l">Price impact</div></div>
          <div className="nm"><div className="v">40s</div><div className="l">Shield time</div></div>
          <div className="nm"><div className="v">0.02%</div><div className="l">Protocol fee</div></div>
        </div>
      </section>

      <section id="roadmap" className="sec container">
        <div className="sec-h rv">
          <div className="sec-k">Roadmap</div>
          <h2>What's shipped, what's next.</h2>
        </div>
        <div className="road rv">
          {ROADMAP.map((r) => (
            <div className="rd" key={r.t}>
              <div className="rq">{r.s}</div>
              <div>
                <div className="rt">{r.t}</div>
                <div className="rx">{r.x}</div>
                <span className="rs">
                  <span className={`pill pill-${r.tone}`}>{r.s}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="sec container">
        <div className="sec-h rv">
          <div className="sec-k">FAQ</div>
          <h2>Questions worth answering upfront.</h2>
        </div>
        <div className="faq rv">
          {FAQ.map((f, i) => (
            <details key={f.q} open={i === 0}>
              <summary>{f.q}</summary>
              <div className="fa">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="final container">
        <div className="in">
          <span style={{ color: "var(--vio-lift)", display: "inline-flex", marginBottom: 18 }}>
            <Mark size={40} />
          </span>
          <h2>Stop publishing your position.</h2>
          <p className="lead">Deposit, shield, and give your agents real tools — without giving up your privacy.</p>
          <div className="cta-row">
            <a href={`${APP_URL}`}>
              <Btn kind="pri" size="lg">Launch app</Btn>
            </a>
            <a href="#stack">
              <Btn kind="sec" size="lg" icon={<IcHistory size={16} />}>See the stack</Btn>
            </a>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="container in">
          <span className="fl">
            <span style={{ color: "var(--vio-lift)" }}>
              <Mark size={20} />
            </span>
            <span>
              Veiled<span className="b">Hood</span>
            </span>
          </span>
          <div className="fc">
            <div className="fg">
              <div className="fgt">Product</div>
              <a href="#stack">Stack</a>
              <a href="#how">How it works</a>
              <a href="#roadmap">Roadmap</a>
            </div>
            <div className="fg">
              <div className="fgt">Resources</div>
              <a href="#faq">FAQ</a>
              <a href={`${APP_URL}`}>Launch app</a>
            </div>
          </div>
          <div className="fb">
            <IcSpark size={13} />
            Robinhood Chain Testnet — chainId 46630
          </div>
        </div>
      </footer>
    </div>
  );
}
