# Spyglass design system

This formalizes the visual language that already exists in
`apps/desktop/src/styles.css` and extends it to marketing surfaces (the
landing page, docs, social cards). It does not invent a new look — every
core token below is lifted from the running app. Where the app's system is
too sparse for a landing page (type scale, motion), this adds the missing
tiers in the same spirit rather than a different one.

Companion doc: [`landing-content.md`](./landing-content.md).

---

## Principles

1. **Dark-first, not dark-only-by-accident.** `apps/desktop` ships
   `color-scheme: dark` with no light theme — this is a devtool meant to
   sit next to a dark editor and simulator, not a general-audience app.
   The landing page should default dark too; a light mode is a nice-to-have,
   not a requirement.
2. **Devtool density.** The product's own type scale tops out at 15px and
   its border-radius tops out at 10px (999px only for pill shapes). Marketing
   surfaces can breathe more than the app does, but should never drift into
   generic-SaaS softness — keep radii tight, keep mono type for anything
   that's data.
3. **One accent, semantics reserved for meaning.** `--accent` (`#5B8CFF`)
   is the only color used decoratively. Green/red/yellow are never
   decorative — they always mean success/error/warning, in the app and on
   the page.

---

## Color

### Core (from `apps/desktop/src/styles.css:1-13`, verbatim)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0F1115` | Page/window background |
| `--bg-elevated` | `#161922` | Cards, panels, raised surfaces |
| `--border` | `#262B38` | Hairline borders, dividers |
| `--text` | `#E6E8EE` | Primary text |
| `--text-muted` | `#8A90A2` | Secondary text, captions |
| `--accent` | `#5B8CFF` | Brand accent, links, primary actions, focus |
| `--accent-soft` | `rgba(91, 140, 255, 0.15)` | Accent fill/hover backgrounds |

### Semantic

| Token | Value | Use |
|---|---|---|
| `--green` | `#34D399` | Success, connected status |
| `--red` | `#F87171` | Error, failed request/level |
| `--yellow` *(new — promote from hardcoded)* | `#FACC15` | Warn. Used 7× hardcoded in `styles.css` and in `AlertSettingsPanel.tsx`'s `LEVEL_META.warn.color` today; there's no `--yellow` variable yet — add one so warn has the same token status as error/success. |

### Storage-engine palette

Each storage adapter gets a fixed identity color, defined in
`StorageView.tsx`'s `ENGINE_META` — reuse these exactly if the landing page
illustrates the Storage view or the integrations grid:

| Engine | Color |
|---|---|
| AsyncStorage | `#5B8CFF` |
| MMKV | `#A78BFA` |
| localStorage | `#22D3EE` |
| sessionStorage | `#94A3B8` |
| SQLite | `#FB923C` |
| WatermelonDB | `#34D399` |
| Realm | `#F472B6` |

### Overlay/fill scale

Translucent whites, layered for elevation and hover states (all in active
use in `styles.css`):

```
rgba(255,255,255,0.02)   rgba(255,255,255,0.025)  rgba(255,255,255,0.03)
rgba(255,255,255,0.04)   rgba(255,255,255,0.06)   rgba(255,255,255,0.08)
```

Semantic tints (success/error/warn washes, e.g. table-row or badge
backgrounds):

```
rgba(52,211,153,0.12)  rgba(52,211,153,0.15)     /* green */
rgba(248,113,113,0.06) rgba(248,113,113,0.12)  rgba(248,113,113,0.15)  /* red */
rgba(250,204,21,0.06)  rgba(250,204,21,0.12)     /* yellow */
rgba(138,144,162,0.15)                             /* neutral */
rgba(0,0,0,0.35)                                   /* shadow */
```

### Contrast check before shipping body copy

`--text-muted` (`#8A90A2`) on `--bg` (`#0F1115`) is ~4.6:1 — passes WCAG AA
for normal text, but only just. Fine for captions and metadata at the
sizes the app already uses (11–13px); **don't** set a landing page's main
paragraph copy in `--text-muted` at a large size and call it "subtle" —
use `--text` for anything meant to be read, `--text-muted` only for
secondary/caption content.

---

## Typography

### Font stacks (from the app, unchanged)

```css
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
--font-mono: "SF Mono", Menlo, monospace;
```

Use `--font-mono` for anything that *is* data: code snippets, JSON, URLs,
env vars, package names. Everything else is `--font-ui`.

### Scale

The app's own scale (10/11/12/13/14/15px) is a devtool scale — reused as-is
for anything on the landing page that quotes the product (embedded
screenshots, "as seen in the app" callouts). It stops at 15px because
nothing in the app is a headline. Marketing needs headline sizes the app
never needed, so this extends the same progression upward:

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Fine print, footer |
| `--text-sm` | 14px | Body small, captions |
| `--text-base` | 16px | Body copy |
| `--text-lg` | 20px | Card titles, subheads |
| `--text-xl` | 24px | Section labels |
| `--text-2xl` | 32px | Section headlines |
| `--text-3xl` | 48px | Hero headline (tablet/desktop) |
| `--text-4xl` | 64px | Hero headline (large desktop only) |

Weights in use: `500` (medium — UI labels), `600` (semibold — emphasis),
`700` (bold — headlines, wordmark). The wordmark and section headlines use
`letter-spacing: 0.02em` (from `.brand` in `styles.css`); body copy uses
normal tracking.

---

## Spacing

No spacing tokens exist in the app today (raw pixel values throughout).
Adopt a standard 4px scale for anything new — landing page or app:

```
4  8  12  16  24  32  48  64  96  128
```

---

## Radius

Pulled from actual usage across `styles.css`:

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Chips, small controls |
| `--radius-md` | 5–6px | Buttons, inputs, table cells |
| `--radius-lg` | 8px | Cards, panels |
| `--radius-xl` | 10px | Modals, larger surfaces |
| `--radius-full` | 999px | Pills (app tabs, badges) |
| `--radius-icon` | ~22% of edge | App icon corner radius (`brand/app-icon.svg` uses `rx="5.2"` on a 24×24 canvas) |

Status dots use `border-radius: 50%`.

---

## Shadow

The app uses exactly one shadow value: `rgba(0, 0, 0, 0.35)`, on elevated
panels over the dark background. Landing page follows the same logic —
shadows are for lifting a dark surface off a darker one, not for
light-mode-style soft drop shadows:

```css
--shadow-elevated: 0 8px 24px rgba(0, 0, 0, 0.35);
```

---

## Motion

The app is almost static by design — a devtool shouldn't animate data out
from under you. Its entire motion vocabulary is three rules:

```css
transition: background 1.6s ease-out;  /* recently-traversed graph edge highlight, fading out */
transition: opacity 0.1s;
transition: transform 0.1s;
```

The landing page can afford more (hero entrance, scroll reveals) but stay
restrained — quick, purposeful, no bouncing or elaborate easing:

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 100ms ease | Hover/press feedback (matches the app) |
| `--motion-base` | 200ms ease-out | Section/card reveals |
| `--motion-slow` | 1.6s ease-out | Only for a deliberate "this just happened" highlight, mirroring the graph-edge pattern above — don't reuse this for routine UI |

---

## Components

### Button

- **Primary** — `--accent` fill, `--bg` text, `--radius-md`. Hover: 8%
  lighter. This is the only filled-accent surface on the page — reserve it
  for one primary CTA per section.
- **Secondary** — transparent fill, `--border` outline, `--text` label.
  Hover: `--bg-elevated` fill.
- **Ghost** — no border, `--text-muted` label, `--accent` on hover. Nav
  links, footer links.

### Code block

`--bg-elevated` background, `--border` 1px outline, `--radius-lg`,
`--font-mono`, `--text` for code, `--accent` for the one line worth
drawing the eye to (e.g. the `init()` call). Copy button top-right,
reusing the app's own `CopyButton` interaction pattern (icon swaps to a
checkmark on click, reverts after ~1.5s).

### Feature card

`--bg-elevated` surface, `--border` outline, `--radius-lg`, `24px` padding.
Icon or engine-color accent top-left, `--text-lg` title, `--text-sm`
`--text-muted` description, optional `--font-mono` "proof detail" line in
`--text-sm` `--text`.

### Badge / pill

`--radius-full`, `--text-xs`, semantic background tint (e.g.
`rgba(52,211,153,0.15)` fill with `--green` text for a "connected" pill) —
mirrors the app's own connected-app pills and alert badges exactly.

### Table

`--border` row dividers, no vertical rules, `--font-mono` for any data
cell (status codes, sizes, timestamps), `--text-muted` for header labels
at `--text-xs`.

### Tabs

Underline style, `--accent` for the active tab and its underline,
`--text-muted` for inactive labels, `--text` on hover — matches the app's
own view-switcher tabs.

---

## Brand

### Mark

`brand/logo-mark.svg` — a geometric "S" monoline stroke (gradient
`#7AA2FF → #5B8CFF`) whose upper terminal is also the spyglass lens: a
light disc (`--text`, `#E6E8EE`) with a small accent-colored glint dot.
Legible down to 16px (verified at 16/32/64/128/256px).

| File | Use |
|---|---|
| `brand/logo-mark.svg` | Full-color mark, transparent background. Assumes a **dark surface** — the lens fill (`#E6E8EE`) is near-white and all but disappears on light backgrounds. Don't place it on white. |
| `brand/logo-mark-mono.svg` | Single-color (`currentColor`) outline variant — the lens becomes a ring instead of a filled disc, since a flat fill loses its shape without a second color to separate it from the stroke. Use on light backgrounds, in print, or anywhere only one color is available. |
| `brand/logo-lockup.svg` | Mark + "Spyglass" wordmark, for nav bars and page headers. Dark-surface only, same reasoning as the color mark. |
| `brand/app-icon.svg` | Mark on a `#0F1115` rounded-square background (`rx` ≈ 22% of the canvas) — the source for the generated app icon set in `apps/desktop/src-tauri/icons/`. |

### Clear space & minimum size

Keep clear space around the mark equal to the lens disc's diameter
(≈ 1/4 of the mark's height) on every side. Don't render the color mark
below 16px — at that size, use the mono variant or the app-icon tile
(the dark background gives the pale lens something to contrast against
even when the S itself compresses).

### Don't

- Don't recolor the gradient — it's the one place the palette allows a
  second blue; introducing a third brand color elsewhere breaks it.
- Don't place the color mark or the lockup on a light/white surface.
- Don't stretch or skew the lockup's mark-to-wordmark spacing — regenerate
  from `brand/logo-lockup.svg`'s source coordinates instead of scaling
  mark and text independently.

---

## Token reference (CSS custom properties)

For a page that wants to consume the same names the app does:

```css
:root {
  color-scheme: dark;

  /* Color — core */
  --bg: #0f1115;
  --bg-elevated: #161922;
  --border: #262b38;
  --text: #e6e8ee;
  --text-muted: #8a90a2;
  --accent: #5b8cff;
  --accent-soft: rgba(91, 140, 255, 0.15);

  /* Color — semantic */
  --green: #34d399;
  --red: #f87171;
  --yellow: #facc15;

  /* Type */
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  --font-mono: "SF Mono", Menlo, monospace;
  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 16px;
  --text-lg: 20px;
  --text-xl: 24px;
  --text-2xl: 32px;
  --text-3xl: 48px;
  --text-4xl: 64px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 10px;
  --radius-full: 999px;

  /* Shadow */
  --shadow-elevated: 0 8px 24px rgba(0, 0, 0, 0.35);

  /* Motion */
  --motion-fast: 100ms ease;
  --motion-base: 200ms ease-out;
  --motion-slow: 1.6s ease-out;
}
```
