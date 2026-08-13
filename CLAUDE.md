# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Spyglass is a visual, real-time inspector for React Native apps: navigation, state management, local storage, console logs and network requests, viewed live in a desktop app. It's a pnpm workspace with three pieces that all talk over one wire protocol:

- `packages/protocol` — dependency-free shared types/helpers for the SDK↔Desktop WebSocket protocol (source of truth; the Rust side is hand-mirrored from it).
- `packages/sdk` (`spyglass-react`) — instrumentation SDK embedded in the target React Native/web app. Opens a WebSocket to the desktop app and streams envelopes.
- `apps/desktop` (`spyglass-desktop`) — Tauri app (React/Vite frontend + Rust backend). The Rust side runs the WebSocket server and forwards events to the frontend via Tauri IPC.

## Commands

Run from the repo root unless noted.

```bash
pnpm install                                   # install workspace deps
pnpm build                                     # build packages/* in dependency order (protocol -> sdk)
pnpm typecheck                                 # tsc --noEmit / tsc -b across all workspace packages
pnpm test                                      # vitest run across all workspace packages
pnpm dev:desktop                               # launch the Tauri desktop app in dev mode
```

Per-package, using pnpm's `--filter`:

```bash
pnpm --filter spyglass-protocol build       # must happen before sdk builds/typechecks —
pnpm --filter spyglass-react build            # sdk depends on protocol's *dist* output (workspace:^), not source

pnpm --filter spyglass-react test             # vitest run
pnpm --filter spyglass-react test -- transport.test.ts   # single test file
pnpm --filter spyglass-protocol typecheck
pnpm --filter spyglass-desktop typecheck    # tsc -b (project references)
```

There is no linter wired up yet (`lint` at the root is a no-op — no package defines a `lint` script).

`apps/desktop` has no unit tests (`test` script is a stub that exits 0); its correctness is exercised via `pnpm dev:desktop` and the Rust side (`cargo check` / `cargo test` from `apps/desktop/src-tauri`).

`packages/protocol` and `packages/sdk` each have two tsconfigs: `tsconfig.json` (used by `typecheck`, includes `src/__tests__`) and `tsconfig.build.json` (used by `build`/`dev`, excludes tests) — so published `dist/` never ships compiled test files, without dropping test coverage from `pnpm typecheck`.

## Publishing

Both `packages/protocol` and `packages/sdk` are public npm packages (`apps/desktop` stays `private`). Release flow is a single manual command, not automated (one maintainer, no CI yet):

```bash
pnpm release   # typecheck && test && build && publish -r --access public
```

Before running it: bump the version in both `package.json`s to the same value (the protocol and SDK are meant to move in lockstep, since the Rust side hand-mirrors `packages/protocol`'s types) and in `SDK_VERSION` in `packages/sdk/src/index.ts` (`__tests__/version.test.ts` fails the build if these drift). `spyglass-react`'s dependency on `spyglass-protocol` is `workspace:^` — pnpm rewrites that to a real semver range (e.g. `^0.1.0`) only during `pnpm publish`/`pnpm pack`, never under plain `npm publish`. Verify a release before trusting it: `pnpm --filter spyglass-react exec pnpm pack` and inspect the resulting tarball — it must contain `dist/` (not `dist/__tests__/`) and the dependency range must not read `workspace:^` verbatim.

## Architecture

### The protocol is the contract

Every message on the wire is an `Envelope<T>` (`packages/protocol/src/types.ts`): `{ v, type, appId, ts, payload }`, where `type` is one of a fixed `MessageType` union (`hello`, `nav/state`, `state/action`, `storage/snapshot`, `log/entry`, `network/request`, etc.) and `payload` is the matching interface from `PayloadByType`. Keep `packages/protocol/src/types.ts` free of RN/Tauri/Node dependencies — it's imported directly by both the SDK (RN runtime) and the desktop UI (webview), and the Rust structs in `apps/desktop/src-tauri/src/registry.rs` are hand-mirrored from it (`serde(rename_all = "camelCase")`), so a shape change there needs a matching Rust edit.

The protocol is overwhelmingly SDK -> Desktop, with one deliberate exception: `storage/write`/`storage/write-result` (spec 0007) flow Desktop -> SDK, letting the desktop's Storage KV editor write a value back into the connected app live. Dev-only — the SDK doesn't register a handler for it outside a dev-style environment (see `InitOptions.allowRemoteWrites` in `packages/sdk/src/index.ts`), and it's the only pair the Rust WS server (`ws_server.rs`) ever sends back down a connection instead of just forwarding to the frontend.

`packages/protocol` also owns:
- `envelope.ts` — `createEnvelope`, `encodeEnvelope`/`decodeEnvelope` (JSON wire format).
- `serialize.ts` — `safeSerialize`/`hashValue`, which bound payload size (`MAX_VALUE_SIZE`, `MAX_SERIALIZE_DEPTH`) and mark oversized/circular values with `TruncatedValue` instead of throwing or blowing up the socket.
- `diff.ts` — `diffValues`/`applyPatch`, a JSON-Patch-like diff so state updates go over the wire as diffs (`state/action`), not full snapshots; the desktop replays diffs onto the last `state/init` to reconstruct current state.
- `constants.ts` — `DEFAULT_PORT` (8098 — deliberately not 8097, which collides with React DevTools' own default and hangs a second physical-iOS connection attempt), heartbeat/timeout intervals, protocol version.

### SDK: adapters over a shared core

`packages/sdk/src/core.ts` holds a module-level singleton (`setCore`/`getCore`) set by `init()` (`index.ts`), exposing the `Transport` and `registerCapability`. Every adapter (`navigation/`, `state/{redux,zustand,jotai,recoil,mobx}.ts`, `storage/{asyncStorage,mmkv,sqlite,realm,watermelondb,webStorage}.ts`, `console.ts`, `network.ts`) calls `getCore()` and must be attached *after* `init()`. Adapters follow the same shape: wrap/patch the target library's own API (a Zustand middleware, a Redux enhancer, `AsyncStorage` method patching, etc.), diff or snapshot state on change, and `core.transport.send(createEnvelope(...))`. Third-party libraries (`redux`, `zustand`, `realm`, `@nozbe/watermelondb`, etc.) are declared as optional `peerDependencies` purely for TS types — adapters reach them via dynamic `import()`, never a static one, so this monorepo's own `node_modules` never needs the native modules installed (see the comment in `pnpm-workspace.yaml`).

`transport/ws.ts`'s `Transport` class handles reconnection (exponential backoff) and queues outgoing envelopes while disconnected (bounded, drops oldest first), so a desktop restart doesn't lose in-flight state. It's constructed against a minimal `WebSocketLike` interface rather than the real DOM type, so tests can inject a fake implementation.

### Desktop: Rust WS server -> Tauri events -> Zustand store -> views

`apps/desktop/src-tauri/src/ws_server.rs` runs the actual WebSocket server (port 8098) and `registry.rs` tracks connected apps and caches, per app, the *latest* envelope of each message type (so a UI reload/reconnect can hydrate without waiting for the app to re-emit). Both are surfaced to the frontend two ways:
- Live push via Tauri events (`app-connected`, `app-disconnected`, `dm-message`), consumed in `apps/desktop/src/ipc.ts`.
- Pull via Tauri commands (`list_apps`, `get_cached_messages`, `forget_app`).

`apps/desktop/src/state/connection.ts` is the single Zustand store all views read from. `handleEnvelope` is a big switch on `envelope.type` that folds each message into per-app `AppData` (nav graph, store snapshots+diffs, storage snapshots, logs, network requests). Notable non-obvious pieces:
- The SDK mints a random `appId` on every `init()` call, so a full app restart (not just a socket blip) looks like a new id; `upsertApp` detects same `(appName, platform)` and treats it as the same logical app reconnecting rather than a duplicate pill.
- The nav graph (`NavGraph`) is persistent and only grows: `nav/state` (the recursive React Navigation tree) upserts nodes/structural edges without counting visits; `nav/transition` is the sole source of truth for visit/traversal counts. `lastAppliedRouteKey` guards against double-counting when a cached transition is replayed on reconnect.
- Since only the *latest* envelope per type is cached server-side, replay-on-reconnect needs care: `state/init` is sorted before `state/action` in `hydrateFromCache`, and `network/request` dedupes by `requestId`.

Views live under `apps/desktop/src/views/<domain>/` (`graph`, `stores`, `storage`, `logs`, `network`), each reading its slice of the connection store for the currently-selected app (`App.tsx` owns the app-pill/tab shell).
