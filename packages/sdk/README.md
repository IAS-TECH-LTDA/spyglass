# spyglass-react

Instrumentation SDK for React Native, Expo and web apps. Streams navigation,
state, storage, console and network events to the
[Spyglass](https://github.com/italosouza/spyglass) desktop inspector.

## Install

```bash
npm install --save-dev spyglass-react
# or: yarn add -D spyglass-react / pnpm add -D spyglass-react
```

### Installing from source (before this is published to npm)

While `spyglass-react` isn't on npm yet, install it straight from a clone
of the [Spyglass monorepo](https://github.com/italosouza/spyglass):

```bash
# in the Spyglass repo — the SDK ships compiled, consumers use dist/, not source
pnpm build

# in your app
npm install /path/to/spyglass/packages/sdk
# or: yarn add file:/path/to/spyglass/packages/sdk
# or: pnpm add /path/to/spyglass/packages/sdk
```

This creates a symlink into the spyglass repo. **Metro doesn't follow that
by default** — it neither watches files outside your project root nor
reliably resolves symlinked packages — so without extra config the bundler
can fail to resolve `spyglass-react`, or resolve it once and never pick up
a rebuilt `dist/`. Add this to your app's `metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config"); // bare RN: require("@react-native/metro-config")
const path = require("path");

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enableSymlinks = true;
config.watchFolders = [path.resolve("/path/to/spyglass")];
module.exports = config;
```

Once this package is published, none of this section applies — a plain
`npm install spyglass-react` resolves normally and needs no Metro changes.

## Usage

Call `init()` once, as early as possible (e.g. the top of `App.tsx`):

```ts
import { init } from "spyglass-react";

init({ appName: "MyApp" });
```

In dev-style environments this alone already gets you console logs, network
requests and performance stalls — see "Auto-attached by default" below.
Navigation and state/storage adapters need one more line each, since they
depend on a reference (a navigation ref, a store instance, …) only your
app's code has:

```ts
import { init } from "spyglass-react";
import { attachNavigation } from "spyglass-react/navigation";
import { createSpyglassReduxMiddleware } from "spyglass-react/state/redux";

init({ appName: "MyApp" });
```

No-ops safely with no reachable desktop app — the transport just keeps
retrying in the background with backoff, so it's safe to leave `init()`
in place across environments.

### Auto-attached by default

`attachConsole()`, `attachNetwork()` and `attachPerformance()` need no
app-specific reference — unlike navigation/state/storage adapters, there's
nothing only your code could hand over — so `init()` attaches all three for
you automatically, in dev-style environments only (`__DEV__`, or
`NODE_ENV !== "production"`), off in production. Override with
`autoAttach`:

```ts
init({ appName: "MyApp", autoAttach: false });                    // none of the three
init({ appName: "MyApp", autoAttach: true });                     // force all three, even in production
init({ appName: "MyApp", autoAttach: { network: false } });       // keep console + performance, skip network
```

Calling `attachConsole()`/`attachNetwork()`/`attachPerformance()` yourself
on top of the auto-attach is a safe no-op — it won't double-report. Use
this if you need to pass the adapter its own options (e.g.
`attachConsole({ levels: ["warn", "error"] })`), which `autoAttach` itself
doesn't support in v1: turn off auto-attach for that one capability and
call the adapter manually instead.

## Adapters

Each subpath wraps one library's own API — attach only the ones you use.

| Import | Exports | Wraps |
|---|---|---|
| `spyglass-react/navigation` | `attachNavigation` | React Navigation |
| `spyglass-react/navigation/react-router` | `useSpyglassReactRouter` | React Router (web) |
| `spyglass-react/state/redux` | `createSpyglassReduxMiddleware` | Redux |
| `spyglass-react/state/zustand` | `withSpyglass` | Zustand |
| `spyglass-react/state/jotai` | `attachJotai` | Jotai |
| `spyglass-react/state/recoil` | `useSpyglassRecoil` | Recoil |
| `spyglass-react/state/mobx` | `attachMobx` | MobX |
| `spyglass-react/storage/async-storage` | `attachAsyncStorage` | `@react-native-async-storage/async-storage` |
| `spyglass-react/storage/mmkv` | `attachMmkv` | `react-native-mmkv` |
| `spyglass-react/storage/sqlite` | `attachSqlite` | SQLite (expo-sqlite or another driver — pass a runner) |
| `spyglass-react/storage/realm` | `attachRealm` | Realm |
| `spyglass-react/storage/watermelondb` | `attachWatermelonDB` | WatermelonDB |
| `spyglass-react/storage/web-storage` | `attachWebStorage` | `localStorage`/`sessionStorage` |
| `spyglass-react/query/react-query` | `attachReactQuery` | TanStack Query |
| `spyglass-react/console` | `attachConsole` | `console.log/info/warn/error/debug` |
| `spyglass-react/network` | `attachNetwork` | `fetch`/`XMLHttpRequest` |
| `spyglass-react/performance` | `attachPerformance` | Render/frame stalls |

Every library above is an optional peer dependency — the SDK reaches them via
dynamic `import()` or a value you pass in, never a static import, so you
never need to install adapters you don't use.

## Connecting from a device

`init()` connects automatically in the common cases:

- **iOS Simulator** and **ReactJS/web** — shares this machine's network, uses
  `localhost`.
- **Physical device** on the same Wi-Fi — the SDK parses the Metro/Expo
  dev-server URL (`NativeModules.SourceCode.scriptURL` and a few fallbacks)
  to find this machine's LAN IP.
- **Android Emulator** — connects via `localhost` once `adb reverse
  tcp:8098 tcp:8098` is in place; the Spyglass desktop app applies this
  automatically while it's open. Without adb available, the SDK falls back
  to the emulator's `10.0.2.2` alias.

If auto-detection guesses wrong for your setup (uncommon — e.g. an Expo
`--tunnel` session), pass `host` explicitly:

```ts
init({ appName: "MyApp", host: "192.168.1.5" });
```

The desktop app's empty screen lists this machine's reachable LAN addresses
and a ready-to-copy snippet per scenario, so you don't have to go find your
own IP.

### Not connecting?

In dev-style environments the SDK logs to the console (never through
whatever `attachConsole()` patches, so this never loops back into the
desktop's own Console tab) once immediately, then at most once every 30s
while it keeps failing:

```
[Spyglass] can't reach the desktop app at ws://localhost:8098 (attempt 7, still retrying).
  · Is the desktop app running?
  · Physical device: init({ appName, host: "<your Mac's LAN IP>" }) — the desktop's empty screen lists them
  · Android emulator: adb reverse tcp:8098 tcp:8098 (the desktop app applies this automatically)
```

Set `diagnostics: false` in `init()` to silence this, or `true` to force it
on outside of dev.

## `InitOptions`

| Option | Type | Default | Notes |
|---|---|---|---|
| `appName` | `string` | — required | Shown in the desktop app's connected-apps list. |
| `host` | `string \| (() => string)` | auto-detected | Skips auto-detection when set. A function is re-invoked on every connection attempt. |
| `port` | `number` | `8098` | |
| `platform` | `"ios" \| "android" \| "web"` | auto-detected | |
| `framework` | `"expo" \| "bare-rn" \| "web" \| "unknown"` | auto-detected | |
| `rnVersion` | `string` | — | Not auto-detected; pass it if you want it shown. |
| `initialConnectDelayMs` | `number` | — | Workaround for a physical-iOS-device boot quirk — see the source comment on `TransportOptions.initialConnectDelayMs`. Not needed on Android or the Simulator. |
| `diagnostics` | `boolean` | on in dev, off in production-style environments | See "Not connecting?" above. |
| `autoAttach` | `boolean \| { console?, network?, performance? }` | on in dev, off in production-style environments | See "Auto-attached by default" above. |

## License

MIT
