# Email draft — SolRouter Tor policy inquiry (Gate A)

**Status:** Draft for the Veiledhood team to send. Do not send as-is until reviewed.

**Send from:** the user's address (founder / partnership lead, not a noreply)
**Send to:** the most accessible SolRouter contact — in order of preference, (a) a DM to @SolRouterAI on X, (b) hello@solrouter.com or support@ (check site footer), (c) Telegram via their public group at https://t.me/+uEgTRV5CivVmYTRi
**Tone:** partnership-flavored, not a hostile probe. Mentions we're building on their SDK so they have an incentive to be helpful.

---

## Subject

`Tor compatibility question — building a Veiledhood integration on @solrouter/sdk`

## Body

Hi SolRouter team,

I'm [Name] from Veiledhood (https://app.veiledhood.to/) — we're a privacy protocol on Base + Ethereum mainnet, shielded balances and private transfers via Merkle vaults. We've been evaluating your SDK as the inference layer for a "Private Chat" feature inside our dapp, and your honest framing (client-side Arcium + AWS Nitro Enclave, no FHE overclaiming) is exactly the right shape for what we want to ship.

One technical question before we commit to a build path. Our threat model includes hiding the user's IP from the inference provider, so we plan to route all outbound calls to `api.solrouter.com` through a Tor SOCKS5 proxy running on our backend. Specifically:

- Tor client (not a relay, not a hidden service) on our DigitalOcean droplet
- `socks-proxy-agent` attached to the SolRouter SDK's HTTP transport
- All user-side traffic flows: Veiledhood dapp → Veiledhood backend → Tor → SolRouter

A few questions:

1. **Do you actively block traffic from Tor exit IPs?** If yes, we have a problem before we start.
2. **If you do block, would you consider allow-listing a partner deployment?** Or do you support Tor bridges (obfs4) that bypass simple exit-list blocking?
3. **Is there a "weird traffic" pattern your abuse-detection might trigger on?** We want to set expectations up front rather than have you discover us via anomaly alerts later.
4. **For billing — our setup is one shared API key funded with USDC, used by many Veiledhood users behind a per-user rate limit.** This is a pooled-identity model on our side. Any policy concerns?

We're not asking for protocol changes on your end. The integration is a thin layer on our side that points at your existing API surface. If a 30-minute call would be easier than email back-and-forth, happy to set one up.

Reply here whenever works, no rush. Thanks for building what you're building.

Best,
[Name]
[Role at Veiledhood]
[Contact]

---

## Notes for the sender

- Replace `[Name]`, `[Role at Veiledhood]`, `[Contact]` before sending.
- If you go via X DM, condense to the first three sentences + question 1 only. Save the rest for the email follow-up they'll likely ask for.
- If they're slow to reply (3+ days), bump on Telegram with a one-liner: "hey, sent an email about a Veiledhood ⇄ SolRouter integration question — anyone there can take a look?"
- Their pinned X post mentions @SarthiB7 as the new Head of Product (joined May 15, 2026). He's a Superteam Germany member; the user (you) may have shared network contacts and can DM him directly if email stalls.
