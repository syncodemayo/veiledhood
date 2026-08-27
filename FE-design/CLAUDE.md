# VeiledHood — implementation constraints

Read `README.md` in this folder first. It is the full spec.

Files in `design/` are **HTML design references**, not production code. Recreate them in this
codebase's own framework and conventions. Do not copy the JSX or ship the HTML.

## Non-negotiables

**The wordmark is one word: `VeiledHood`.** `Veiled` at weight 500, `Hood` at weight 800 in
`#A88CFF`. If it sits in a flex row with `gap`, wrap the whole wordmark in a single element —
a bare text node becomes its own flex item and the gap lands between "Veiled" and "Hood".

**Never colour text with `--tx4`** (`rgba(244,244,246,.34)`). It measures 2.9:1. It is for icon
tints and borders only. Text labels use `--tx3` (`.52`, 5.28:1). Every text role in this design
clears 4.5:1 — keep it that way.

**Violet has two values and they are not interchangeable.** `--vio` `#8257FF` for fills and
buttons; `--vio-lift` `#A88CFF` for violet *text and icons* on dark. Using `--vio` for type is
too dim.

**The mark has 14 units of padding built into its 100-unit artboard** (ink spans x=14→86). Do
not add padding around it. Below 20px use the compact variant, which drops the nested core.

**Numbers are always DM Mono with `tabular-nums`.** They must not jitter while animating.

**Content must never depend on JavaScript to be visible.** Scroll-reveal resting state must have
a fallback that shows content if the observer never fires. Stat counters must always land on the
true value — these are factual claims and a displayed `0` is a false one.

## SVG sprites

If you build a `<symbol>` + `<use>` sprite, put `fill`/`stroke` **on the symbol**. CSS on the
host `<svg>` does not cross into the shadow tree `<use>` creates; clones fall back to
`fill:black`. Only `color` inherits, so `currentColor` works once paint is on the symbol.

## Architecture

- **Privacy mode is global.** When off, every monetary value renders masked. Use context.
- **One confirmation component.** Screens supply `{title, rows, cta, steps}`; the modal owns the
  review → signing → done phases. Do not duplicate per screen.
- **Replace `vh-data.js` entirely.** It is mock data.
- Swap `setInterval` counters and the visible-by-default reveal fallback for normal
  `requestAnimationFrame` and IntersectionObserver — those were preview-environment workarounds.

## Build order

Tokens → primitives → shell + routing + privacy context → Portfolio → Swap → remaining screens
→ landing page.
