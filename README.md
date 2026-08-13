# Spyglass

Spyglass is a visual, real-time inspector for React Native, Expo and
ReactJS apps: navigation, state management, local storage, console logs and
network requests, viewed live in a desktop app — similar in spirit to
[Reactotron](https://github.com/infinitered/reactotron), built as a pnpm
monorepo of three pieces that talk over one wire protocol.

<!-- screenshot placeholder: apps/desktop's graph/state/storage views -->

## What you get

- **Live views** of navigation (a graph, not a log), Redux/Zustand/Jotai/
  Recoil/MobX state, Storage (AsyncStorage/MMKV/SQLite/Realm/WatermelonDB/
  web Storage), React Query's cache, console logs, network requests and
  render/frame performance.
- **JSON as a node diagram**, not a wall of text — every JSON payload in the
  app (state, storage values, request/response bodies, query data) renders
  as a diagram; click a field to open it in a side column.
- **Live editing from the desktop**, dev builds only: change a Storage KV
  value or a Zustand store's state and it applies in the running app
  immediately, plus a "Clear app caches" action. See the
  [`packages/sdk` README](./packages/sdk/README.md#live-editing-from-the-desktop)
  for exactly what this can and can't do.
- **Memory/swap monitoring** (Android real devices/emulators, iOS
  Simulator) — device total memory, the connected app's own memory and
  swap, read directly by the desktop app (`adb`/`footprint`), no extra code
  needed in your app at all.

## Packages

| Package | What it is |
|---|---|
| [`spyglass-protocol`](./packages/protocol) | Dependency-free shared types/helpers for the SDK↔Desktop WebSocket protocol. Source of truth — the Rust side of the desktop app is hand-mirrored from it. |
| [`spyglass-react`](./packages/sdk) | Instrumentation SDK embedded in your React Native/Expo/web app. Opens a WebSocket to the desktop app and streams events. |
| `apps/desktop` | Tauri app (React/Vite frontend + Rust backend) — the desktop inspector itself. Not published; download/build it to run locally. |

## Quick start

1. Run the desktop app (`pnpm dev:desktop` from a clone of this repo, or a
   built release once one exists).
2. In your app:
   ```bash
   # whichever your app already uses
   npm install --save-dev spyglass-react
   yarn add --dev spyglass-react
   pnpm add --save-dev spyglass-react
   ```
   ```ts
   import { init } from "spyglass-react";

   init({ appName: "MyApp" });
   ```
3. Attach whichever adapters your app uses (Redux, Zustand, AsyncStorage,
   console, network, …) — see [`packages/sdk`'s README](./packages/sdk/README.md).

The SDK auto-detects the desktop app's host in the common cases (iOS
Simulator, Android Emulator, a physical device on the same Wi-Fi) — no
`host` option needed for most setups. If nothing connects, open the desktop
app: its empty screen lists this machine's reachable addresses and the exact
snippet to use for your scenario.

## Development

This is a pnpm workspace. From the repo root:

```bash
pnpm install                                   # install workspace deps
pnpm build                                     # build packages/* in dependency order (protocol -> sdk)
pnpm typecheck                                 # tsc --noEmit / tsc -b across all workspace packages
pnpm test                                      # vitest run across all workspace packages
pnpm dev:desktop                               # launch the Tauri desktop app in dev mode
```

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture writeup, per-package
commands, and the release flow.

## License

[MIT](./LICENSE)
