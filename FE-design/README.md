# Handoff: VeiledHood — landing page + app

## Overview

VeiledHood is a privacy protocol on Robinhood Chain. Users hold **shielded** balances alongside
public ones, swap without publishing a traceable trail, bridge value in and out of a shielded
pool, and give AI agents real tooling over their positions without handing over plaintext
config or keys.

This bundle covers two surfaces:

1. **Marketing landing page** — one long scrolling page, animated, ending in a CTA into the app.
2. **The app** — a sidebar dashboard with ten screens, a wallet-connect gate, and a shared
   transaction confirmation flow.

---

## About the design files

**The files in `design/` are design references, not production code.**

They are HTML/CSS/JSX prototypes built to communicate intended look, layout and behaviour. They
run in a browser via CDN React and in-browser Babel, use a small mock data module instead of a
real chain, and are not structured for production.

**Your task is to recreate these designs in the target codebase**, using its existing framework,
component library, state management and styling conventions. If there is no codebase yet, pick
the framework that suits the product (a React + TypeScript SPA, or Next.js if the landing page
should be server-rendered for SEO) and build there.

Treat the CSS files as the **source of truth for values** — colours, spacing, radii, type — and
port them into whatever token system the codebase uses (Tailwind config, CSS custom properties,
theme object). Do not ship `vh-*.jsx` as-is; they exist to show composition and behaviour.

---

## Fidelity

**High-fidelity.** Colours, typography, spacing, radii, animation timings and copy are all final
and intentional. Recreate the UI faithfully. Where this document gives an exact value, use it.

Two deliberate constraints worth preserving:

- **Contrast floor of 4.5:1** for all text. Every text role in the design measures ≥ 5.26:1
  against its real backdrop. The token `--tx4` (34% alpha) is for **non-text use only** — icon
  tints, borders, disabled glyphs. Never colour text with it.
- **The wordmark is one word.** `VeiledHood` — never "Veiled Hood". See *Brand* below.

---

## Tech notes before you start

Three things in the prototypes are workarounds for the preview environment and should be
**replaced, not ported**:

1. **Scroll reveals** use an IntersectionObserver with a visible-by-default CSS fallback, because
   IO callbacks don't fire in the preview iframe. In a real browser, use a normal IO-driven
   reveal — but keep the principle that **content must be visible if JS fails**. Never author
   `opacity: 0` as the resting state without a fallback.
2. **Count-up animations** use `setInterval` plus a hard floor that snaps to the true value,
   because `requestAnimationFrame` isn't delivered in the preview. Use `requestAnimationFrame`
   in production. Keep the guarantee that a real number always ends up on screen — the stats are
   factual claims and must never read `0`.
3. **`vh-data.js`** is mock data. Replace entirely with real chain reads and API calls.

---

## Brand

**Name:** `VeiledHood` — one word, camelCase. In the wordmark, `Veiled` is weight 500 and
`Hood` is weight 800 in violet. The case break carries the meaning, so a word space destroys it.

> Implementation note: if the wordmark sits in a flex container with `gap`, wrap the whole
> wordmark in **one element**. A bare text node becomes its own anonymous flex item and the gap
> will be applied between "Veiled" and "Hood". This bug occurred twice during design.

**The mark** (`brand/mark-violet.svg`) is an arch band with a nested core — hood at a glance,
closing aperture on second read.

- Artboard is `0 0 100 100` but the **ink spans only 72 units** (x=14→86). There are 14 units of
  padding built in on every side. **Do not add your own padding** when placing it in a component.
- **Clear space** = the span of the mark's open void, measured between the band's inner edges
  (50 of 100 viewBox units). Nothing enters that margin.
- **Below 20px, use the compact mark** (`mark-compact-violet.svg`), which drops the nested core.
  The full mark's 12-unit gaps close up and mush at favicon sizes.

Paths, if you want to inline them rather than load a file:

```
Full mark   M14 88V52a36 36 0 0 1 72 0v36H75V52a25 25 0 0 0-50 0v36z
            M37 88V52a13 13 0 0 1 26 0v36z
Compact     M14 88V52a36 36 0 0 1 72 0v36H72V52a22 22 0 0 0-44 0v36z
```

Both use `fill: currentColor`, no stroke.

> **SVG sprite warning:** if you build an icon sprite with `<symbol>` + `<use>`, put
> `fill`/`stroke` **on the symbol**, not on the host `<svg>`. CSS on the host does not cross into
> the shadow tree that `<use>` creates, and clones fall back to `fill:black; stroke:none`. Only
> `color` inherits — which is why `currentColor` works once paint is declared on the symbol.

---

## Design tokens

Ported verbatim from `design/vh-tokens.css`.

### Colour

| Token | Value | Use |
|---|---|---|
| `--vio` | `#8257FF` | Primary. Buttons, active states, accent bars |
| `--vio-lift` | `#A88CFF` | Violet **text and icons on dark** — `--vio` is too dim for type |
| `--vio-deep` | `#5B32D6` | Gradient end only |
| `--vio-dim` | `rgba(130,87,255,.13)` | Tinted fills, active nav background |
| `--vio-line` | `rgba(130,87,255,.34)` | Violet borders |
| `--vio-glow` | `rgba(130,87,255,.42)` | Drop shadows, orbs |
| `--ink` | `#08090B` | Page ground |
| `--p1` | `#0E0F14` | Panel / card surface |
| `--p2` | `#14151C` | Inset surface, inputs |
| `--p3` | `#1B1D26` | Raised control, secondary button |
| `--p4` | `#23252F` | Hover state, track |
| `--line` | `rgba(255,255,255,.08)` | Default hairline |
| `--line2` | `rgba(255,255,255,.14)` | Emphasised border |
| `--line3` | `rgba(255,255,255,.22)` | Hover border |
| `--tx` | `#F4F4F6` | Primary text |
| `--tx2` | `rgba(244,244,246,.72)` | Body text |
| `--tx3` | `rgba(244,244,246,.52)` | **Labels, captions, secondary text** (5.28:1) |
| `--tx4` | `rgba(244,244,246,.34)` | **NON-TEXT ONLY** — icon tint, borders (2.9:1) |
| `--pos` | `#3FD98B` | Positive delta, success |
| `--neg` | `#FF5C72` | Negative delta, error |
| `--warn` | `#FFB44C` | Warning, exposure callouts |

Each semantic colour has a `-dim` variant at `.13` alpha for tinted backgrounds
(`--pos-dim`, `--neg-dim`, `--warn-dim`).

### Typography

- **Display / UI:** Archivo — weights 400, 500, 600, 700, 800, 900
- **Mono:** DM Mono — weights 400, 500. Used for all numbers, labels, addresses, code

Numbers are **always** mono with `font-variant-numeric: tabular-nums` so they don't jitter as
they animate or update.

| Role | Size | Weight | Letter-spacing |
|---|---|---|---|
| Hero h1 | `clamp(42px, 5.6vw, 72px)` | 800 | `-.045em` |
| Section h2 | `clamp(29px, 3.5vw, 42px)` | 800 | `-.038em` |
| Panel title | 14px | 700 | `-.012em` |
| Feature title | 17px | 700 | `-.022em` |
| Body / lead | 16–17px | 400 | `-.011em`, line-height 1.62 |
| Card body | 13.5px | 500 | `-.008em`, line-height 1.58 |
| Stat value | 22–34px | 500 mono | `-.03em` |
| Label (`.lbl`) | 10px | 500 mono | `.16em`, uppercase |
| Detail row | 11–12px | 500 mono | — |

Tight negative tracking on large type is a defining trait of the brand — don't drop it.

### Spacing, radius, layout

- Spacing steps actually used: `6, 8, 10, 12, 14, 16, 18, 22, 26, 32, 44, 52, 88`
- Radii: `--r1: 6px`, `--r2: 10px`, `--r3: 14px`, `--r4: 20px`. Pills use `100px`
- Sidebar rail: `236px`. Top bar: `64px`. Landing container: `1200px` max, `28px` gutter
- App content: `1240px` max for dashboards, `520px` for single-column forms (swap, bridge, vault)

### Elevation

Shadows are used sparingly — only modals, toasts and the terminal.

```
modal    0 32px 80px rgba(0,0,0,.62), 0 0 0 1px rgba(130,87,255,.34)
toast    0 18px 44px rgba(0,0,0,.5)
terminal 0 24px 60px rgba(0,0,0,.5)
```

Emphasis is carried by a **violet ring** rather than shadow:
`border: 1px solid var(--vio); box-shadow: 0 0 0 5px rgba(130,87,255,.06)`.

---

## Part 1 — Landing page

File: `design/VeiledHood Landing.html` + `design/vh-landing.css`

Single scrolling page. Sections in order:

### 1. Nav — sticky, 66px
Logo lockup left, five anchor links, "Docs" ghost button and "Launch app" primary button right.
Background `rgba(8,9,11,.76)` with `backdrop-filter: blur(16px)`. Bottom border is transparent
at rest and becomes `--line` once `scrollY > 8`. Links hide below 860px.

### 2. Hero
Two-column grid `1.08fr / .92fr`, collapsing to one column at 960px.

Left: an eyebrow pill ("Live on Robinhood Chain", pulsing dot), h1 "Private by / construction."
with the second line in a violet gradient clip, a lead paragraph, two CTAs, then a four-item
stat row above a top border.

Stats: `24,180` notes in pool · `$48.2M` shielded TVL · `20,640` agent calls · `0` prompts
leaked. All count up on entry except the last, which is literally zero and is the point.

Right: the animated aperture — four nested arch outlines at 94/74/54/34% scale, each running a
5.5s `breathe` keyframe (scale 1 → 1.045, opacity .13 → .3) staggered 0.5s apart, with the solid
mark at centre carrying a `42px` violet drop-shadow. Sixteen 9px violet squares drift upward
through it on randomised 5–9s loops as "notes entering the pool".

Two blurred gradient orbs drift behind on 22s and 27s loops.

### 3. Marquee
Full-width band, `--p1` background, hairline top and bottom. Ten privacy primitives with icons,
duplicated and translated `-50%` over 26s for a seamless loop.

### 4. Problem — "A public chain publishes more than you think."
Four amber-accented cards: Who you are · What you hold · What you did next · When you act.
Hover lifts 3px and shifts the border amber.

### 5. Stack — "Nine surfaces. One privacy layer."
Three-column grid on `--p1`. The nine features are: Private swap, Shielded vault, Bridge, Wallet
context, Staking, Encrypted data, Private inference, MCP server, Agent payments. Each card has a
violet icon tile, title, description and a status line.

Cards track the pointer: a `320px` radial violet glow follows the cursor via `--mx`/`--my`
custom properties set in a `pointermove` handler, faded in on hover.

### 6. How it works
Four-step pipeline in one bordered row: Deposit → Commit → Prove → Settle. A 2px violet bar
fills each step's bottom edge on an 8s loop staggered 2s apart, so attention walks the pipeline.

### 7. Agents
Two columns. Left: heading, lead, and a four-item checklist. Right: a fake terminal with a
titlebar and a **typing animation** that plays a real MCP session — a wallet-context read
returning actual portfolio numbers, then a private rebalance settling. Types at 21ms per
character (9ms for comment lines), pauses 4.2s at the end, then clears and loops.
`min-height: 238px` prevents layout shift while it types.

### 8. Architecture
Two panels either side of a `÷` glyph: off-chain private computation vs on-chain verifiable
settlement. Below, four counting stats: `24,180` anonymity set · `0.04%` price impact · `40s`
shield time · `0.02%` protocol fee.

### 9. Roadmap
Five rows, each a `104px` label column plus content. Three "Shipped" with green pills, one
"Next" with a violet pill, one "Later" muted.

### 10. FAQ
Six `<details>` disclosures, first open. The `+` marker rotates 45° when open.

### 11. Final CTA + footer
Centred mark, "Stop publishing your position.", two CTAs. Footer has the lockup, three link
columns, and a bottom bar with a live mainnet indicator.

### Landing animation summary

| Animation | Trigger | Timing |
|---|---|---|
| Section reveal | IO on enter | `opacity` + `translateY(22px)`, 0.7s `cubic-bezier(.2,.8,.3,1)`, 0.08s stagger |
| Count-up | IO at 50% | 1.4s, cubic ease-out |
| Aperture breathe | always | 5.5s infinite, 0.5s stagger |
| Note drift | always | 5–9s linear infinite, random delay |
| Orb drift | always | 22s / 27s infinite alternate |
| Marquee | always | 26s linear infinite |
| Pipeline bar | always | 8s infinite, 2s stagger |
| Terminal typing | IO at 30% | 21ms/char, 4.2s loop pause |
| Card glow | pointermove | 0.3s opacity fade |

All reveals respect `prefers-reduced-motion: reduce`.

---

## Part 2 — App

Files: `design/VeiledHood App.html`, `vh-shell.*`, `vh-primitives.jsx`, `vh-screens-*.jsx`

### Shell

Two-column grid: `236px` rail + fluid main. Main is a `64px` top bar over a scrolling content
area. The rail has the logo lockup, three nav groups, then a settings item and a wallet chip
pinned to the bottom.

Nav groups:
- **Trade** — Swap, Bridge, Vault
- **Assets** — Portfolio, Staking
- **Private** — Data, Agent (badge "AI"), MCP (badge "2"), Payments

Active nav item: `--vio-dim` background, full-opacity label, violet icon, and a `2.5px` violet
bar bleeding off the left edge.

Top bar shows the screen title and subtitle, plus a **privacy-mode toggle** and a network chip.

**Privacy mode** is global: when off, every monetary value in the app renders as `••••••` via a
`Mask` component. Implement this as context, not prop drilling — it touches every screen.

Below 900px: rail becomes a `262px` drawer sliding in over a scrim, a hamburger appears in the
top bar, and a five-item bottom tab bar appears (Portfolio, Swap, Vault, Agent, More) with
`env(safe-area-inset-bottom)` padding.

### Screens

**Onboarding** — full-screen gate outside the shell. Two steps: wallet picker (three options,
1.1s simulated connect with a spinner on the chosen row), then a privacy-default confirmation.
Progress dots below; the active dot is a 20px pill.

**Portfolio** — the default screen. Shows skeleton shimmer for 900ms on mount, then: four stat
cards (Total, Shielded — violet-ringed, Public, Privacy score "A−"), a range-switchable area
chart, a shielded-vs-public donut with a per-token legend, and an activity feed. Activity rows
carry a "Private" pill where applicable.

**Swap** — 520px column. Pay/receive inputs with a circular flip button overlapping between
them (`-9px` margins, 3px border in the panel colour to punch through the divider). A "Private
route" toggle, then detail rows: rate, price impact, route, network fee, min received. When
private, an extra toggle offers a one-time recipient address, revealing a violet chip with the
stealth address.

**Bridge** — chain pickers either side of a swap button, amount input, "Arrive shielded"
toggle, detail rows, and an empty "in flight" panel.

**Vault** — shielded/public stat pair, deposit/withdraw tabs, an amount input and a dashed
read-only "you get" field. **The body copy changes with the mode** — depositing explains
shielding; withdrawing warns that an amount becomes public. The detail row switches from
"Anonymity set: 24,180 notes" to "Reveals: Amount only" in amber.

**Staking** — three stats, a privacy banner, three pools with APR, your stake and a
stake/manage button.

**Data** — three stats, a privacy banner, and a searchable record list. Tags are shown as
`#tag`. Includes a real empty state with distinct copy for "nothing stored" vs "no search
results", plus a link to preview it.

**Agent** — chat transcript with the user right-aligned and the agent left-aligned with the mark
as its avatar. Sending shows a "Sealing prompt · paying · inferring" spinner for 1.5s. Chat body
is `min-height: 340px; max-height: 460px`. Three stats below.

**MCP** — a copyable JSON config block, a list of six exposed tools, and connected clients with
live/idle/off pills and working connect/revoke buttons.

**Payments** — four stats, a privacy banner, a services table with per-call pricing, a live
settlement stream of stealth addresses, and a 14-bar call-volume chart.

**Settings** — three panels of toggles: privacy defaults (shield, decoys, jitter, Tor),
interface (mask values, auto-shield), and wallet details.

### Confirmation flow

Every write action routes through one modal with three phases:

1. **review** — a privacy banner, detail rows, Cancel + confirm buttons
2. **signing** — a stepper advancing every 780ms; close is disabled
3. **done** — green check, a summary, and a linked tx hash

Each screen supplies its own `steps` array, so the stepper narrates that specific operation —
e.g. a private swap reads "Building shielded note → Proving membership → Submitting to pool →
Settling on Robinhood Chain". Build this as **one** component; don't duplicate per screen.

Confirmation success fires a toast that auto-dismisses after 3.4s.

### State

| State | Scope | Notes |
|---|---|---|
| `entered` | app | Gates onboarding vs shell |
| `route` | app | Persisted to `localStorage` under `vh.route` |
| `priv` | app | Privacy mode — needed by every screen |
| `confirm` | app | Payload: `{title, rows, cta, steps, kind}` |
| `phase` | app | `review` / `signing` / `done` |
| `stepIdx` | app | Driven by an effect on a 780ms timer |
| `toast` | app | Keyed by timestamp so repeats re-trigger |
| `drawer` | app | Mobile rail open |
| form state | screen | Amounts, token pairs, toggles |
| `loading` | screen | Portfolio skeletons |

### Data to wire up

- Shielded and public balances per token, with USD prices
- Historical series for the portfolio chart, per range
- Activity feed with a private/public flag per entry
- Swap quotes: rate, price impact, min received, fee, route
- Bridge quotes and in-flight transfer status
- Staking pools: APR, TVL, user stake, unclaimed rewards
- Encrypted records: label, tags, size, timestamp (ciphertext client-side)
- Agent: inference endpoint, per-call price, call and spend counters
- MCP: client sessions, exposed tools, connect/revoke
- Payments: services with pricing, settlement stream, call volume

---

## Accessibility

- Every text role meets 4.5:1. Do not colour text with `--tx4`
- All interactive elements have a `:focus-visible` ring: `2px solid var(--vio)`, `2px` offset
- The privacy toggle is a real `role="switch"` with `aria-checked`
- Modals close on Escape and on backdrop click — except during `signing`
- Icon-only buttons carry `aria-label` and `title`
- Mobile hit targets are ≥ 44px

---

## Files

### `design/`
| File | Contents |
|---|---|
| `VeiledHood Landing.html` | Landing page — markup, sprite sheet, all animation JS |
| `VeiledHood App.html` | App entry — routing, privacy mode, confirmation flow, toasts |
| `VeiledHood Logo.html` | Logo spec board — construction, lockups, colour variants, clear space |
| `vh-tokens.css` | **Design tokens.** Port this first |
| `vh-components.css` | Buttons, pills, inputs, toggles, rows, modal, stepper, tabs, toast |
| `vh-shell.css` | Rail, top bar, content, mobile drawer and tab bar |
| `vh-landing.css` | Landing-only styles and keyframes |
| `vh-icons.jsx` | Mark component and 28 icons |
| `vh-primitives.jsx` | Btn, Pill, Panel, Stat, AssetInput, Toggle, Modal, Step, Spark, Ring, Bars, Toast |
| `vh-shell.jsx` | Nav config, Rail, Top, MobileTabs, Mask |
| `vh-screens-core.jsx` | Onboarding, Portfolio, Staking, Settings |
| `vh-screens-trade.jsx` | Swap, Bridge, Vault |
| `vh-screens-private.jsx` | Data, Agent, MCP, Payments |
| `vh-data.js` | **Mock data — replace entirely** |

### `brand/`
Mark as SVG in three colours plus two compact variants, favicons at 512/64/32, X avatar and
banner, a horizontal lockup PNG, and `BRAND.txt` with the full brand spec.

---

## Suggested build order

1. Port tokens and load Archivo + DM Mono
2. Build primitives — Btn, Pill, Panel, Stat, DRow, ListRow, Toggle, Modal
3. Build the shell with routing and privacy-mode context
4. Portfolio first — it exercises stats, charts, lists and skeletons
5. Swap next — it exercises inputs, toggles and the confirmation flow end to end
6. The remaining screens reuse those pieces
7. Landing page last; it shares only tokens, not components

## Open items

- No dedicated mobile mockups exist. Both surfaces are responsive and the breakpoint behaviour
  is documented above, but native app screens were never designed.
- Copy is final for everything present, but legal, docs and pricing pages don't exist yet.
