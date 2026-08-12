# spyglass-react

Instrumentation SDK for React Native, Expo and web apps. Streams navigation,
state, storage, console and network events to the
[Spyglass](https://github.com/italosouza/spyglass) desktop inspector.

## Install

```bash
# whichever your app already uses — all three install the same package
npm install --save-dev spyglass-react
yarn add --dev spyglass-react
pnpm add --save-dev spyglass-react
```

## Usage

Call `init()` once, as early as possible (e.g. the top of `App.tsx`):

```ts
import { init } from "spyglass-react";

init({ appName: "MyApp" });
```

In dev-style environments this alone already gets you console logs, network
requests and performance stalls — see "Auto-attached by default" below.
Navigation, state and storage adapters need one more line each, since they
depend on a reference (a navigation ref, a store instance, …) only your
app's code has. Every adapter reads the connection `init()` set up, so
`init()` has to run first — called before it, an adapter throws
`[Spyglass] SDK not initialized`.

No-ops safely with no reachable desktop app — the transport just keeps
retrying in the background with backoff, so it's safe to leave `init()`
in place across environments.

### A complete example

A React Native app wiring up React Navigation, Redux Toolkit and
AsyncStorage — shown in the order the bundler evaluates the files, since
that order is what makes `createSpyglassReduxMiddleware()` see an
initialized SDK when the store is created.

```ts
// spyglass.ts — no exports; imported first, purely for its side effects
import AsyncStorage from "@react-native-async-storage/async-storage";
import { init } from "spyglass-react";
import { attachAsyncStorage } from "spyglass-react/storage/async-storage";

init({ appName: "MyApp" });
attachAsyncStorage(AsyncStorage);
```

```ts
// store.ts
import { configureStore } from "@reduxjs/toolkit";
import { createSpyglassReduxMiddleware } from "spyglass-react/state/redux";
import { rootReducer } from "./rootReducer";

export const store = configureStore({
  reducer: rootReducer,
  // Runs at store-creation time, i.e. while this module is being
  // evaluated — so ./spyglass must be imported before this one.
  middleware: (getDefault) => getDefault().concat(createSpyglassReduxMiddleware()),
});
```

```tsx
// App.tsx
import "./spyglass"; // first import: init() runs before anything reaches for it
import { useEffect } from "react";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { Provider } from "react-redux";
import { attachNavigation } from "spyglass-react/navigation";
import { RootStack } from "./RootStack";
import { store } from "./store";

export default function App() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => attachNavigation(navigationRef.current!), []);

  return (
    <Provider store={store}>
      <NavigationContainer ref={navigationRef}>
        <RootStack />
      </NavigationContainer>
    </Provider>
  );
}
```

Swap in whichever adapters your app actually uses — the call sites differ,
the ordering rule doesn't. Two adapters are hooks rather than functions, so
they attach from inside a component instead: `useSpyglassReactRouter()`
under `<BrowserRouter>`, and `useSpyglassRecoil(atoms)` under
`<RecoilRoot>`. See "Adapters" below for the full list.

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
