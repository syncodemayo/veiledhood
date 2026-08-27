# Bloom partnership — guidance

**Status:** Open. Sent Shape 1 offer 2026-05-27 11:57.
**Partner contact:** Bloom dev (Telegram, anon)
**Their pitch:** DeFi agent runtime — "agents that bloom your yield"
**Trust profile:** Anonymous team · no public audit · Clanker memecoin · unverifiable TVL · real product, real users, thin signal

## What we offered (Shape 1 — light touch)

> Adopt `@veiledhood/agent-crypto` in their agent runtime. Strategies encrypted on user's device. Bloom stores ciphertext only. Bloom markets "fully private strategies."

**Lift:** ~1 week on their side. Zero engineering on ours.
**Risk:** Lowest possible. If Bloom turns out to be a scam, exposure is `npm uninstall`.
**Revenue:** None direct. We win on brand + adoption + npm downloads.

## How to handle the next reply

### If Bloom says yes / asks for docs

- Point them at the public package: https://www.npmjs.com/package/@veiledhood/agent-crypto
- Walk-through is in the existing README (no new docs needed)
- Ask them for:
  - Public attribution on their site (link back to veiledhood.to)
  - X / blog announcement when they ship
  - A test run (encrypt → store → decrypt) on testnet before mainnet rollout
- **Don't commit:** to support SLAs, on-call rotation, or custom-build hours

### If Bloom asks for tighter integration (Shape 2/3/4)

Hold the line on Shape 1 first. Trust must be earned before deeper coupling.

Acceptable next-step language:
> Let's ship Shape 1 first and see real adoption. Once it's live and we both have data, we can scope Shape 3 (Bloom strategies as a template inside Veiledhood's agent layer).

**Don't agree to:**
- Custom endpoints on our infra
- Joint product branding
- Vault liquidity commitments
- Revenue-share contracts
- Co-marketing beyond a single launch post

…until Bloom ships an audit AND has named team members public.

### If Bloom asks "can Veiledhood vault hold our user funds?"

Polite no. That's Shape 2 — needs Shape 1 to land first + Bloom audit. Reply:
> Shape 2 (vault as private settlement) is on the table but only after the npm integration is in production and stable. Bigger surface area = need to see your audit/team first.

### If Bloom asks for money / equity / Veiledhood token allocation

Hard no. We're not investing in them — we're offering tech. If they push, the partnership isn't serious.

### If Bloom ghosts > 7 days

Don't chase. Move on. Note in memory + drop the thread.

## Upgrade paths (in order, only after each prior step proves out)

| Step | Trigger | Bloom must show |
|---|---|---|
| Shape 1 → Shape 3 | npm package adopted, no incidents for 30 days | First named team member; testnet usage stats |
| Shape 3 → Shape 2 | Strategy template in prod, >100 users | Audit report; verified TVL |
| Shape 2 → Shape 4 | Vault execution stable for 90 days | Full team identities; legal entity; >$1M TVL verifiable |

## Red flags to watch

- Pressure tactics ("we need to ship this week or move on")
- Vague timelines without concrete milestones
- Pushing for Veiledhood to take on infra risk before they take on audit risk
- Asking for our agent-crypto source to be forked / re-published under their name (kill instantly)
- Token swap / treasury exposure requests
- Demands for co-marketing without delivering shipped integration first

## What Veiledhood is NOT willing to do (north-star)

- Custody Bloom user funds outside our shielded vault model
- Endorse Bloom publicly before they're auditable
- Take Bloom token allocation as compensation
- Build Bloom-specific endpoints in our core API
- Co-sign on a joint product until audit + named team

## What Veiledhood IS willing to do (Shape 1 scope)

- Maintain `@veiledhood/agent-crypto` (already published, semver-stable)
- Tag a Bloom integration test in CI if they contribute one
- Single launch post acknowledging the integration (no co-branding)
- Light Telegram support during their integration week

## Talking points if they push back

- "Fully private agent strategies, zero added trust" — biggest market position they can earn here
- "Same primitive Claude Code's veiledhood-mcp uses for its 7 agent tools" — credibility transfer
- "AES-GCM + HKDF, wallet-signature-derived key — audited primitives, audited spec" — defuses tech objections
- "Lowest-lift first; deeper later if it works" — keeps door open without commitment

## Internal review trigger

If anyone offers Shape 2+ before Shape 1 ships, escalate before responding. Brand-risk asymmetry is significant: Veiledhood is 3 years old with named contributors; Bloom is anon. Deeper integration without parity = misaligned exposure.

---

**Last updated:** 2026-05-27 by Megumi after sending Shape 1 offer.
