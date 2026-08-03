# @datamobile/sdk

Instrumentation SDK for React Native, Expo and web apps. Streams navigation,
state, storage, console and network events to the
[DataMobile](https://github.com/italosouza/datamobile) desktop inspector.

## Install

```bash
npm install --save-dev @datamobile/sdk
# or: yarn add -D @datamobile/sdk / pnpm add -D @datamobile/sdk
```

## Usage

Call `init()` once, as early as possible (e.g. the top of `App.tsx`), then
attach whichever adapters your app uses:

```ts
import { init } from "@datamobile/sdk";
import { attachNavigation } from "@datamobile/sdk/navigation";
import { createDataMobileReduxMiddleware } from "@datamobile/sdk/state/redux";

init({ appName: "MyApp" });
```

No-ops safely with no reachable desktop app — the transport just keeps
retrying in the background with backoff, so it's safe to leave `init()`
in place across environments.

## Adapters

Each subpath wraps one library's own API — attach only the ones you use.

| Import | Exports | Wraps |
|---|---|---|
| `@datamobile/sdk/navigation` | `attachNavigation` | React Navigation |
| `@datamobile/sdk/navigation/react-router` | `useDataMobileReactRouter` | React Router (web) |
| `@datamobile/sdk/state/redux` | `createDataMobileReduxMiddleware` | Redux |
| `@datamobile/sdk/state/zustand` | `withDataMobile` | Zustand |
| `@datamobile/sdk/state/jotai` | `attachJotai` | Jotai |
| `@datamobile/sdk/state/recoil` | `useDataMobileRecoil` | Recoil |
| `@datamobile/sdk/state/mobx` | `attachMobx` | MobX |
| `@datamobile/sdk/storage/async-storage` | `attachAsyncStorage` | `@react-native-async-storage/async-storage` |
| `@datamobile/sdk/storage/mmkv` | `attachMmkv` | `react-native-mmkv` |
| `@datamobile/sdk/storage/sqlite` | `attachSqlite` | SQLite (expo-sqlite or another driver — pass a runner) |
| `@datamobile/sdk/storage/realm` | `attachRealm` | Realm |
| `@datamobile/sdk/storage/watermelondb` | `attachWatermelonDB` | WatermelonDB |
| `@datamobile/sdk/storage/web-storage` | `attachWebStorage` | `localStorage`/`sessionStorage` |
| `@datamobile/sdk/query/react-query` | `attachReactQuery` | TanStack Query |
| `@datamobile/sdk/console` | `attachConsole` | `console.log/info/warn/error/debug` |
| `@datamobile/sdk/network` | `attachNetwork` | `fetch`/`XMLHttpRequest` |
| `@datamobile/sdk/performance` | `attachPerformance` | Render/frame stalls |

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
  tcp:8098 tcp:8098` is in place; the DataMobile desktop app applies this
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
[DataMobile] can't reach the desktop app at ws://localhost:8098 (attempt 7, still retrying).
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

## License

MIT
