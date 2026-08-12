# Spyglass

Spyglass is a visual, real-time inspector for React Native, Expo and
ReactJS apps: navigation, state management, local storage, console logs and
network requests, viewed live in a desktop app — similar in spirit to
[Reactotron](https://github.com/infinitered/reactotron), built as a pnpm
monorepo of three pieces that talk over one wire protocol.

<!-- screenshot placeholder: apps/desktop's graph/state/storage views -->

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
