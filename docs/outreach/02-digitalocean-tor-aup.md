# Email draft — DigitalOcean Tor client AUP clarification (Gate C)

**Status:** Draft for the Veiledhood team to send. Do not send as-is until reviewed.

**Send from:** the DigitalOcean account-holder email (the address that owns the `ai-agent-marketplace-nodejs-app` droplet, ID `491096632`). Support ties replies to the account.
**Send to:** support@digitalocean.com — or, easier, file a support ticket from inside the DigitalOcean dashboard (you'll get faster routing than cold email).
**Tone:** matter-of-fact, technical, no apology. Tor client usage is normal and almost certainly permitted; we're just getting a paper trail in case anomaly detection ever flags us.

---

## Subject

`AUP clarification — running a Tor client on droplet 491096632 for outbound API privacy`

## Body

Hi DigitalOcean Support,

Quick clarification request to confirm we're AUP-compliant before we deploy a change.

We run an Express/Node API on droplet `491096632` (region fra1, IPs 167.71.59.86 and 134.199.189.208) that calls a third-party AI inference provider on behalf of our users. Our threat model requires hiding the originating IP from that provider, so we plan to install a standard Tor client on the droplet and route those outbound API calls through it.

To be specific about what we're doing — and what we're NOT doing:

- ✅ Installing the standard `tor` package via apt
- ✅ Configuring it to listen on `127.0.0.1:9050` as a SOCKS5 client (local-only, never exposed to the internet)
- ✅ Our Node.js code uses `socks-proxy-agent` to route specific outbound HTTPS requests through this local SOCKS5 port
- ❌ NOT operating a Tor relay (no inbound traffic from the Tor network)
- ❌ NOT running a Tor exit node (no third-party traffic exiting our droplet)
- ❌ NOT hosting a Tor hidden service (no `.onion` listeners)
- ❌ NOT operating Tor bridges for third parties

This is purely outbound client-side use for our own application's API calls. The droplet's overall network behavior doesn't change — same volume, same outgoing destinations from an aggregate perspective, just routed differently for one API endpoint.

Could you confirm this falls within the AUP? We want a paper trail in case the use pattern ever gets flagged by anomaly detection.

Thanks,
[Name]
DigitalOcean account holder
[Email tied to the account]

---

## Notes for the sender

- Replace `[Name]` and `[Email tied to the account]` before sending.
- Filing the support ticket from inside the DO dashboard is faster than cold email — it routes to the right team and they reply within 24h typically.
- DO's AUP (https://www.digitalocean.com/legal/acceptable-use-policy) doesn't explicitly mention Tor. Standard public-internet research suggests Tor *client* usage is permitted; Tor *relays* and exit nodes can be subject to additional terms. This email exists to get that confirmation in writing for the specific use case.
- If they push back ("we don't allow Tor"), the fallback is to move the Tor daemon to a small separate VPS (Hetzner, Vultr — both explicitly Tor-tolerant), tunnel from the main droplet to it via Wireguard, and route AI requests through that tunnel. Adds ~$5/mo and ~1 day of setup. Not preferable but viable.
