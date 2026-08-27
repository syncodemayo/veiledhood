# Brief — VeilAI × x402 × PayAI Concept Demo Video

**Status:** Concept demo (think *concept car*). Not a shipped product. Should look aspirational, polished, internally consistent — but the receiving audience will understand this is a sneak-peek of where the protocol is heading, not a live feature.

**Deliverable:** A single self-contained HTML file (SVG + CSS + JS, no build step, no external assets except web fonts already on the brand system). Opens in any modern browser. Designed to be screen-captured and posted to X / website hero.

**Output filename:** `x402-concept-demo.html`

---

## Audience & goal

- **Audience:** crypto-native developers, AI agent builders, privacy-curious AI tooling users. Crossover of Anthropic MCP early adopters + Base/Coinbase x402 community + DeFi privacy folks.
- **Goal:** show the *narrative* — Veiledhood's encrypted agents can autonomously pay any x402-protected service from a shielded balance, with the receiving party seeing only the Veiledhood vault (not the user). This is the killer hook of merging:
  - Encrypted-agents stack (shipped, Phase 2)
  - x402 protocol (Coinbase + Cloudflare, GA)
  - PayAI Network as facilitator (live)
- **Emotional beat:** "this is the future of agentic payments — encrypted, autonomous, private."

---

## Format spec

| Attribute | Value |
|---|---|
| Aspect | 16:9 (1920×1080) |
| Length | 30–40 seconds |
| Loopable | Yes — final frame can dissolve back into opening frame |
| Frame rate target | 60fps animations, but readable at 30fps capture |
| Audio | None (silent demo, will be paired with caption text on X) |
| Output medium | Single `.html` file; recorder will capture to MP4/GIF |

---

## Storyboard — scene by scene

### Scene 1 — Open (0s–3s)

- Veiledhood wordmark / logo fades in, brief glitch / shimmer effect (privacy aesthetic — implying obfuscation).
- Tagline appears underneath: **"Encrypted agents. Real payments."**
- Sub-tagline (smaller): **"x402 × PayAI × Veiledhood — Concept, 2026"**

### Scene 2 — Claude window (3s–10s)

- Mock Claude Desktop window appears (use a stylized window chrome — no need for pixel-perfect macOS replication; the *idea* of a chat UI is enough).
- User-message bubble types out (typing effect, ~80ms/char):
  > **"Pay $0.01 to fetch the current ETH gas oracle and report back."**
- Claude assistant bubble appears below with a thinking ellipsis, then a tool-call card animates in:
  ```
  ▸ Tool: agents.pay_x402
      url: https://oracle.example/gas
      maxUsd: 0.01
  ```

### Scene 3 — Flow diagram (10s–22s)

This is the centerpiece. The Claude window slides to the left third of the canvas. The right two-thirds reveals an animated flow diagram (horizontal pipeline, left-to-right):

```
[ Claude ]  →  [ MCP server 🔒 ]  →  [ Veiledhood API ]  →  [ PayAI Facilitator ]  →  [ x402 Endpoint ]
                                          │
                                          ▼
                                   [ Shielded Vault ]
                                   ━━━━━━━━━━━━━━━━━
                                   Balance: $1,247.32
```

Animation:
- A glowing dot travels left → right along the pipeline, ~2 seconds per leg.
- The leg from MCP → Veiledhood API has a padlock icon and the dot is visibly *encrypted* (e.g., it's a small ciphertext-glyph chip, not a clean dot, when on this leg). Once it crosses the Veiledhood boundary it becomes a clean USDC coin.
- When the dot reaches PayAI Facilitator, a small "SETTLE" pill flashes and a dotted line drops down to a Shielded Vault counter.
- **Shielded Vault counter ticks**: `$1,247.32 → $1,247.31` with a subtle decrement animation. A tiny caption: *"Receiver sees: Veiledhood vault, not your wallet"*.

### Scene 4 — On-chain proof (22s–28s)

- A small "Basescan" style card slides in below the pipeline. **Important: clearly label it `CONCEPT — illustrative only`** to avoid any accusation that we faked a real tx.
- Card shows:
  ```
  Tx: 0x7a3f…b91c   [CONCEPT]
  From: Veiledhood Shielded Vault (0x58a4…De4a)
  To:   x402 Merchant
  Amount: 0.010 USDC · Base
  PayAI · Facilitator
  ```
- Card has a green checkmark "Confirmed" badge.

### Scene 5 — Return + close (28s–35s)

- The flow diagram dot returns left along the pipeline carrying data.
- Claude assistant bubble in the chat window updates from the thinking ellipsis to:
  > **"Gas: 12 gwei. Oracle confirmed. $0.01 settled via PayAI."**
- Camera pulls back; Claude window + flow diagram both fade.
- End card centered:
  > **VeilAI × x402**
  > Encrypted agents. Autonomous payments. No KYC.
  > **Concept · Coming 2026**

(If looping, dissolve back to Scene 1.)

---

## Exact copy strings (please use verbatim — keeps marketing consistent)

| Where | String |
|---|---|
| Opening tagline | `Encrypted agents. Real payments.` |
| Opening sub-tagline | `x402 × PayAI × Veiledhood — Concept, 2026` |
| User prompt typed | `Pay $0.01 to fetch the current ETH gas oracle and report back.` |
| Tool-call card | `agents.pay_x402` · `url`, `maxUsd` shown |
| Vault caption | `Receiver sees: Veiledhood vault, not your wallet` |
| Basescan card label | `CONCEPT — illustrative only` |
| Claude reply | `Gas: 12 gwei. Oracle confirmed. $0.01 settled via PayAI.` |
| End card line 1 | `VeilAI × x402` |
| End card line 2 | `Encrypted agents. Autonomous payments. No KYC.` |
| End card line 3 | `Concept · Coming 2026` |

---

## Visual / brand notes

- **Use the existing Veiledhood brand system** — palette, typography, motion language, logo. Defer to whatever the brand library / Figma source defines for primary, accent, surface, text colors.
- **Privacy aesthetic** — slight scanline / grain texture acceptable on background. Subtle glow / bloom on accent elements is on-brand.
- **Padlock + ciphertext motif** — use Veiledhood's existing iconography for "encrypted" if available; otherwise a simple monoline padlock matching the icon set.
- **Logos to include:** Veiledhood (primary), x402 (small, in the flow diagram on the corresponding pipeline node), PayAI (small, on the facilitator node). Both x402 and PayAI logos should be sourced from their respective brand pages (x402.org / payai.network). All three lockups treated equally in size — Veiledhood is the host, x402/PayAI are partners.
- **No fake confidence theatre.** The basescan card must be clearly labelled `CONCEPT`. Tx hash and amounts are illustrative. Vault balance is illustrative. We want concept-car energy, not deceptive demo energy.

---

## Technical implementation hints (for whoever builds the HTML)

These are suggestions, not requirements — pick what fits your toolchain:

- **Animation engine:** GSAP timeline OR plain CSS keyframes with a small JS orchestrator. No heavy frameworks needed. Lottie acceptable if export exists.
- **Diagram:** inline SVG with `<animate>` / `<animateMotion>` along `<path>` elements for the traveling dot. Easier than canvas.
- **Typing effect:** simple `setInterval` over characters; ~80ms/char for user prompt, ~50ms/char for Claude reply.
- **Balance counter:** drive with a small JS interval that decrements $1,247.32 to $1,247.31 in ~600ms with a slight ease.
- **No external requests at runtime.** Bundle any fonts via `@font-face` (Base64 acceptable) or use system fonts. The file should run offline.
- **Browser target:** Chromium-based (Chrome, Edge, Brave). Designer / recorder will use one of these.
- **Recording hint:** include a hidden `?capture=1` query param that auto-plays the timeline once and stops on the end card, so a screen recorder gets a deterministic clean take.

---

## Out of scope (do not include)

- ❌ Real wallet connect / real wallet-signature dialogs.
- ❌ Real basescan iframe — concept card only.
- ❌ Real PayAI API call. Everything is animated.
- ❌ Audio / voiceover.
- ❌ Multi-language. English copy only for v1.
- ❌ Dark/light mode toggle. Dark only — privacy aesthetic.
- ❌ Any claim that this is a live product. Always label CONCEPT.

---

## Definition of done

1. Single `x402-concept-demo.html` file delivered.
2. Opens cleanly in Chromium; full storyboard plays in 30–40s.
3. Loop is seamless (final frame → opening frame dissolve).
4. All copy strings match the table above verbatim.
5. CONCEPT labelling visible in Scene 4.
6. Veiledhood, x402, PayAI brand marks all rendered correctly per their brand systems.
7. Renders identically at 1920×1080 and 1280×720 (no overflow / clipping).
8. No console errors. No external network requests at runtime.

---

## Context for the designer (background — read this first)

Veiledhood is a privacy-focused crypto protocol on Base. We already ship:
- **Encrypted prompts + Tor** through SolRouter (Phase 1, live)
- **MCP server + encrypted agents** — strategies stored as ciphertext, decrypted only on the user's machine (Phase 2, live)
- **Shielded USDC vault** at `0x58a498Da97737117E7FaDbC924dA654c0153De4a` on Base (live)
- **Encrypted data storage** (live, May 2026)

**x402** is Coinbase's HTTP 402 protocol for stablecoin-native API payments — agents pay per request from a USDC balance. **PayAI Network** runs an open x402 facilitator at `facilitator.payai.network`, ~14% of all x402 transaction volume.

The concept being demo'd: Veiledhood's encrypted agents can pay any x402-protected service via PayAI's facilitator, signing from the **Veiledhood shielded vault** rather than the user's own wallet — preserving the privacy property the protocol is built on. Receiver sees Veiledhood, not you.

This concept video is the **public reveal** of that integration direction. We have not built it yet. We are showing the world what we're building toward.

---

## Reference links (for the designer)

- Veiledhood dApp: https://app.veiledhood.to (use as brand reference)
- x402 protocol: https://github.com/coinbase/x402 — logo at https://x402.org
- PayAI Network: https://docs.payai.network — logo at https://payai.network
- Coinbase x402 docs: https://docs.cdp.coinbase.com/x402/welcome
- Concept-car energy reference: see e.g. Audi e-tron GT concept reveal, Tesla Cybertruck reveal — aspirational, polished, clearly labelled concept.

---

*End of brief.*
