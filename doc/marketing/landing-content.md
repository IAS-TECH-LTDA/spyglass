# Spyglass — landing page content

Source-of-truth copy for the marketing site, in sections. Every claim here is
checked against the current code (`packages/sdk`, `packages/protocol`,
`apps/desktop`) as of the Spyglass rebrand — nothing describes a feature that
doesn't exist yet. Language: English (the SDK, protocol and existing READMEs
are all English; the RN/Expo audience this targets is global).

Companion doc: [`design-system.md`](./design-system.md) has the tokens,
type scale and components this copy should be built with.

---

## 0. Global stage note

**Update (2026-08-13):** `spyglass-react`/`spyglass-protocol` are published
on npm and the desktop app now ships packaged, self-updating builds via
GitHub Releases (see `doc/produto/specs/0009-auto-update-desktop.md`) — the
"pre-npm, clone and run only" framing below is stale and this page needs a
pass before publishing. Original note, kept for context:

**The product is pre-npm, one commit in.** `spyglass-react` and
`spyglass-protocol` are not published; the desktop app has no packaged
build (~~`bundle.active: false` in `tauri.conf.json`~~ — this was already
inaccurate when written; the real blocker was simply that no release
pipeline existed yet — no `.dmg`/`.exe` to download). Every CTA on this page
reflects that honestly: "clone and run," never "download" or "npm install"
as the primary action. Revisit this page once
`doc/produto/specs/0003-publicacao-npm.md` ships.

---

## 1. Nav

**Elements:** logo lockup (`brand/logo-lockup.svg`) on the left · links:
`Features` `Integrations` `Docs` `GitHub` · nothing behind auth, no pricing
link (there's no pricing — it's MIT and free).

**Note:** `GitHub` is the real primary CTA disguised as a nav link — see
Hero.

---

## 2. Hero

**Headline:**
> See inside your React Native app while it runs.

**Subhead:**
> Spyglass streams navigation, state, storage, console and network activity
> from your Expo, React Native or React app straight into a live desktop
> inspector — no `console.log`, no reload, no losing your place.

**CTAs:** Primary `View on GitHub` → repo. Secondary `Read the docs` → SDK
README.

**Visual:** screenshot or looping capture of the **Navigation graph** view
(`apps/desktop/src/views/graph/GraphView.tsx`) — it's the most immediately
legible view to someone who's never seen the product: a live node graph of
screens with traversal counts, which reads as "oh, it's watching my app"
in under a second. (`README.md` still has this exact screenshot as an open
placeholder — fill both from the same capture.)

**Implementation note:** keep the headline about *seeing inside a running
app*, not about debugging in the abstract — that's the one sentence that
differentiates this from "yet another logger."

---

## 3. Stage banner

Thin banner directly under the hero, not a modal, dismissible:

> **Early access.** Spyglass is v0.1.0 and not yet on npm — today you clone
> the repo and run `pnpm dev:desktop`. The SDK API is stable enough to build
> against; expect the installer story to improve fast.

---

## 4. Problem

**Headline:**
> `console.log`, reload, squint, repeat.

**Body:**
> React Native gives you a console and, if you're lucky, a breakpoint. It
> doesn't show you the screen your user was actually on when a request
> failed, what your Redux store looked like a second before a crash, or
> which AsyncStorage key silently grew to 2MB. Every one of those questions
> today means adding a temporary log, reloading, and reproducing the bug
> again — hoping it still reproduces.

**Sub-point (three columns or a short list):**
- *Console and Network* — visible, but only if you're staring at the right
  tab at the right moment.
- *State and Storage* — invisible entirely unless you print it yourself.
- *Navigation* — you can't see the shape of how your users actually move
  through the app, only the screen in front of you.

**Bridge line to next section:**
> Spyglass gives all four a live, shared window — across as many connected
> devices and simulators as you're running at once.

---

## 5. How it works

Three steps, each with the *real* snippet — nothing paraphrased:

**Step 1 — Install**
```bash
npm install --save-dev spyglass-react
```

**Step 2 — One line**
```ts
import { init } from "spyglass-react";

init({ appName: "MyApp" });
```
> That line alone, in a dev build, already streams console logs, network
> requests and frame-performance stalls — see "Zero-config" below.

**Step 3 — Open the desktop app**
> `spyglass-react` finds it automatically on the iOS Simulator, an Android
> Emulator, or a physical device on the same Wi-Fi. No `host` config for
> the common cases.

**Implementation note:** this section doubles as the honest install
instructions given the pre-npm stage banner — don't let a designer swap
step 1 for a fake "Download for Mac" button.

---

## 6. Features

Eight cards, one per real view in `apps/desktop/src/views/`. Each card:
icon (reuse the storage-engine-color language from the design system where
relevant), title, one-sentence description, one concrete detail that proves
it's real (not marketing fluff).

| View | Title | Description | Proof detail |
|---|---|---|---|
| `graph/` | **Navigation graph** | Watch your users' actual path through the app as a live, growing graph. | Screens are nodes, transitions are edges with visit counts; the most recently traversed edge highlights for a moment so you can watch it happen. |
| `stores/` | **State** | Inspect any store's current state and every action that changed it. | Works with Redux, Zustand, Jotai, Recoil and MobX — pick the store from a sidebar list, browse state as a JSON tree, scroll the action log. |
| `storage/` | **Storage** | Browse key-value and relational storage side by side, per engine. | AsyncStorage, MMKV, localStorage/sessionStorage as key-value tables; SQLite, WatermelonDB and Realm as full schemas with a diagram — including automatic foreign-key inference, so `gallery_id` on one table links straight to `product_gallery` without you wiring it up. |
| `queries/` | **Queries** | See every TanStack Query key, its status, and its data. | Status and fetchStatus at a glance, data/error as an expandable tree, one-click copy of the key or the data. |
| `logs/` | **Console** | Every `console.log/info/warn/error/debug`, searchable, still printing normally in Metro too. | Filter by level, search, expand structured args — and it keeps printing to your normal terminal/logcat, this doesn't replace that. |
| `network/` | **Network** | Every `fetch` and `XMLHttpRequest` — method, status, timing, full request/response bodies. | One click turns any request into a ready-to-paste `curl` command. |
| `performance/` | **Performance** | Real FPS and dropped-frame stalls, correlated to the screen that was active. | No `<Profiler>`, no React internals hooked — just JS-thread frame timing, sampled every 2s, with a stall event the instant a frame takes longer than 200ms. |
| — (alerts) | **Alerts** | Get pulled back to the right tab the moment something breaks. | A failed request or an error/warn log lights up a badge on the app pill and the relevant tab, plays a short sound, and — if Spyglass is in the background — fires a native macOS notification. Configurable per app, per level, mutable with one click. |

---

## 7. Integrations

**Headline:**
> Works with the state, storage and navigation libraries you already use.

Grid of 17 adapters, grouped exactly as the SDK ships them (mirrors the
table in `packages/sdk/README.md` — keep these two in sync):

**Navigation**
- React Navigation
- React Router (web)

**State**
- Redux / Redux Toolkit
- Zustand
- Jotai
- Recoil
- MobX

**Storage**
- AsyncStorage
- MMKV
- SQLite (any driver — expo-sqlite, react-native-sqlite-storage, op-sqlite)
- Realm
- WatermelonDB
- localStorage / sessionStorage

**Query**
- TanStack Query

**Always on (see Zero-config)**
- Console
- Network (fetch / XMLHttpRequest)
- Performance (frame timing)

**Footnote (small print, but real):**
> Every library above is an optional peer dependency. Spyglass reaches each
> one through a dynamic `import()` — never a static one — so installing the
> SDK never forces you to install libraries you don't use.

---

## 8. Zero-config

**Headline:**
> `init({ appName })`. That's it, most of the time.

Two sub-blocks:

**Auto-attach**
> Console, network and performance need no reference to your app's code to
> hook into — so `init()` wires up all three automatically, in dev builds
> only. Production is opt-in, not opt-out. Need to skip just one?
> `init({ appName, autoAttach: { network: false } })`.

**Auto-detect host**
> Spyglass finds the desktop app without you typing an IP address, in every
> common setup:
> - **iOS Simulator** — shares this Mac's network, `localhost` just works.
> - **Android Emulator** — Spyglass keeps `adb reverse tcp:8098 tcp:8098`
>   applied automatically while it's open; falls back to `10.0.2.2` if adb
>   isn't available.
> - **Physical device on the same Wi-Fi** — the SDK parses the Metro/Expo
>   dev-server URL to find your Mac's LAN address, the same technique
>   Reactotron uses.
>
> Wrong guess for an unusual setup (e.g. an Expo `--tunnel` session)? Pass
> `host` explicitly — but for everyone else, there's nothing to configure.

---

## 9. Comparison

Honest, not chest-thumping — every "yes" below is something the code
actually does today.

| | **Spyglass** | Reactotron | React DevTools | Flipper |
|---|---|---|---|---|
| Navigation graph with live traversal counts | ✅ | – | – | – |
| State — Redux/Zustand/Jotai/Recoil/MobX | ✅ (5 libs) | Redux, MobX | – | Redux plugin |
| Relational storage schema + FK inference | ✅ | – | – | – |
| Network with Copy-as-cURL | ✅ | Partial | – | ✅ |
| Frame-stall detection | ✅ | – | Profiler tab | – |
| Native OS alerts on error | ✅ | – | – | – |
| Web/ReactJS support | ✅ | – | ✅ (React only) | – |
| Zero-config host detection | ✅ | ✅ | n/a | Partial |
| Actively maintained (2026) | ✅ | Community-maintained | ✅ | Archived |

**Footnote:**
> React DevTools remains the right tool for component-tree and render-cause
> inspection — Spyglass doesn't try to replace it (and deliberately runs on
> port 8098, not 8097, so the two run side by side without colliding).

---

## 10. Under the hood

For the readers who want to know *why* it's built this way — three short,
technical, credibility-building items:

- **Diffs, not snapshots.** State updates go over the wire as JSON-Patch-like
  diffs against the last known state, not full re-serializations — cheap
  even on a store with a large tree.
- **Rust, not Electron.** The desktop app is Tauri: a Rust WebSocket server
  plus a native window, not a bundled Chromium runtime.
- **Nothing you don't use.** Every adapter is an optional peer dependency
  reached via dynamic `import()`. Installing `spyglass-react` doesn't pull
  in Redux, Realm, or anything else you're not already using.

---

## 11. FAQ

**Does this run in production?**
> No, and it shouldn't — auto-attach is dev-only by default, and the socket
> is unauthenticated on your local network. Keep `init()` calls dev-gated.

**Does it slow my app down?**
> The instrumentation patches `console`/`fetch`/`XMLHttpRequest` and samples
> frame timing every 2 seconds — designed to be invisible in normal use.
> With no desktop app reachable, the transport just retries quietly in the
> background with backoff; nothing throws, nothing blocks.

**Does it work with plain ReactJS, not just React Native?**
> Yes — console, network, localStorage/sessionStorage, React Router and
> TanStack Query all work in a browser app too.

**Does it work with Expo Go?**
> Yes, same as any Expo dev build; Spyglass detects Expo vs. bare RN
> automatically.

**Does any of my data leave my machine?**
> No — the SDK opens a WebSocket directly to the desktop app on your local
> network (or `localhost`). There's no cloud relay.

**Is it free?**
> Yes, MIT-licensed, both packages.

---

## 12. Final CTA

**Headline:**
> Stop guessing what your app is doing.

**Body:**
> Clone the repo, run the desktop app, add one line to your project.

```bash
git clone https://github.com/IAS-TECH-LTDA/spyglass.git
cd spyglass && pnpm install && pnpm dev:desktop
```

**CTA:** `View on GitHub`

---

## Footer

Columns: **Product** (Features, Integrations, Comparison) · **Docs** (SDK
README, Protocol README, Architecture) · **Project** (GitHub, Issues,
License — MIT).

Small print: `Spyglass · v0.1.0 · MIT License`
