/**
 * English strings — the source of truth for every translation key. `pt.ts`
 * is typed as `Translations` (`Record<keyof typeof en, string>`), so a key
 * added here without a matching Portuguese entry fails `pnpm typecheck`
 * instead of silently falling back at runtime.
 *
 * Flat, dot-namespaced keys (`"storage.empty"`) rather than nested objects —
 * gives autocomplete on the whole key without a path-typing helper, and
 * keeps `en`/`pt` diffable line by line.
 *
 * Plural keys come in `_one`/`_other` pairs, resolved by `tp()` in
 * `./index.ts`; every `{name}` token is filled in by `t()`'s interpolation
 * (see `interpolate()`) or, when the value itself needs to be a React node
 * (e.g. a `<code>` snippet), by `<Trans>`.
 *
 * Proper nouns — library/tool names (Redux, Zustand, AsyncStorage, SQLite,
 * npm, adb, …), code snippets, and single symbols (▸, ×, →) are deliberately
 * NOT translation keys: they read the same in every language, so routing
 * them through `t()` would just be indirection with no payoff.
 */
export const en = {
  // ---------------------------------------------------------------------
  // common
  // ---------------------------------------------------------------------
  "common.copy": "Copy",
  "common.copyFailed": "Copy failed",
  "common.close": "Close",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.retrying": "Retrying…",
  "common.dismiss": "Dismiss",
  "common.refresh": "Refresh",
  "common.moreCount": "+{count} more",
  "common.copyValue": "Copy value",
  "common.repoLink": "Questions or found a bug? Visit the GitHub repository",

  // ---------------------------------------------------------------------
  // app shell (App.tsx)
  // ---------------------------------------------------------------------
  "app.brand": "Spyglass",
  "app.waitingForApp": "Waiting for an app…",
  "app.removeFromList": "Remove from list",
  "app.removeAppAria": "Remove {name}",
  "app.tabs.navigation": "Navigation",
  "app.tabs.state": "State",
  "app.tabs.storage": "Storage",
  "app.tabs.queries": "Queries",
  "app.tabs.console": "Console",
  "app.tabs.network": "Network",
  "app.tabs.performance": "Performance",

  // ---------------------------------------------------------------------
  // settings popover (components/SettingsPanel.tsx, formerly AlertSettingsPanel)
  // ---------------------------------------------------------------------
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.language.english": "English",
  "settings.language.portuguese": "Português",
  "settings.alerts": "Alerts",
  "settings.alerts.on": "Alerts on",
  "settings.alerts.muted": "Muted",
  "settings.triggerOn": "Trigger on",
  "settings.level.error": "Error",
  "settings.level.warn": "Warn",
  "settings.networkFailures": "Network failures",
  "settings.notifyWith": "Notify me with",
  "settings.sound": "Sound",
  "settings.macNotification": "macOS notification",
  "settings.notificationBlocked": "Blocked in System Settings › Notifications › Spyglass.",
  "settings.tryAgain": "Try again",
  "settings.apps": "Apps",
  "settings.noAppsYet": "No apps connected yet.",
  "settings.version": "Spyglass {version}",
  "settings.madeBy": "Made by IASTech",

  // ---------------------------------------------------------------------
  // connect (views/connect/ConnectView.tsx)
  // ---------------------------------------------------------------------
  "connect.scenario.device": "Physical device",
  "connect.scenario.iosSimulator": "iOS Simulator",
  "connect.scenario.androidEmulator": "Android emulator",
  "connect.title": "No app connected yet",
  "connect.subtitle": "Spyglass is listening on {url}. Add the SDK to your app and it shows up here.",
  "connect.step1Title": "Install the SDK",
  "connect.step2Title": "Pick your scenario",
  "connect.step3Title": "Call {init} — usually at the top of {file}",
  "connect.step4Title": "Attach a state adapter (optional)",
  "connect.note.iosSimulator": "Shares this Mac's network — the SDK detects “localhost” automatically.",
  "connect.note.androidEmulator": "Auto-detected. Spyglass keeps “adb reverse tcp:8098 tcp:8098” applied for you (status below); without adb the SDK falls back to “10.0.2.2”.",
  "connect.note.device": "Same Wi-Fi as this Mac. The SDK usually detects this from the Metro URL — pass “host” only if it doesn't.",
  "connect.lanAddresses": "LAN addresses on this machine",
  "connect.refreshLanAria": "Refresh LAN addresses",
  "connect.noLanAddress": "No LAN address found — is this machine on Wi-Fi?",
  "connect.primary": "primary",
  "connect.adaptersNote": "Navigation, storage (AsyncStorage, MMKV, SQLite, Realm, WatermelonDB) and React Query have their own adapters — see the SDK README.",
  "connect.listeningOn": "Listening on {url}",
  "connect.adb.checking": "Checking for adb…",
  "connect.adb.applied": "adb reverse applied · {devices}",
  "connect.adb.partial": "adb reverse applied to {ok} of {total} devices — {detail}",
  "connect.adb.noDevices": "adb found, no devices attached — starts automatically once one connects",
  "connect.adb.notFound": "adb not found",
  "connect.adb.error": "adb error",

  // ---------------------------------------------------------------------
  // memory (components/memory/MemoryPanel.tsx)
  // ---------------------------------------------------------------------
  "memory.title": "Memory",
  "memory.notAvailable": "Memory monitoring isn't available for this platform yet.",
  "memory.clearCaches.notice": "\"Clear app caches\" runs the JS engine's garbage collector and clears image caches in the connected app right now.",
  "memory.clearCaches.button": "Clear app caches",
  "memory.clearCaches.tooltip": "Runs the JS engine's garbage collector and, if the app uses expo-image, clears its image cache. Can't free memory system-wide — no third-party app can ask the OS for that.",
  "memory.device": "Device",
  "memory.selectDevice": "Select a device…",
  "memory.package": "Package",
  "memory.selectPackage": "Select a package…",
  "memory.useSuggested": "Use suggested: {package}",
  "memory.deviceTotal": "Device total",
  "memory.deviceAvailable": "Device available",
  "memory.appPhysical": "App (physical)",
  "memory.appSwap": "App swap",
  "memory.simulator": "Simulator",
  "memory.selectSimulator": "Select a booted Simulator…",
  "memory.appBundleLabel": "App bundle name (e.g. \"MyApp\" for MyApp.app)",
  "memory.simulatorMacOnly": "Simulator memory needs the desktop app running on macOS.",
  "memory.noSimulator": "No booted Simulator found.",
  "memory.waitingForSimApp": "Waiting for the app to appear in this Simulator…",
  "memory.appPhysFootprint": "App (phys_footprint)",
  "memory.physicalNote": "Running on a physical iPhone/iPad? Not supported yet — see spec 0008 for why (no lightweight public API exists).",

  // ---------------------------------------------------------------------
  // network (views/network/NetworkView.tsx)
  // ---------------------------------------------------------------------
  "network.filterPlaceholder": "Filter by URL, method or status…",
  "network.requestCount_one": "{count} request",
  "network.requestCount_other": "{count} requests",
  "network.clearAllAria": "Clear all requests",
  "network.emptyState": "No network activity yet. Attach {call} from {module}.",
  "network.noMatches": "No matches.",
  "network.resizeListAria": "Resize request list",
  "network.status": "Status",
  "network.method": "Method",
  "network.duration": "Duration",
  "network.started": "Started",
  "network.copyAsCurl": "Copy as cURL",
  "network.related": "Related",
  "network.relatedQuery": "Query: {preview}",
  "network.relatedStorage": "Storage: {key} ({engine})",
  "network.request": "Request",
  "network.response": "Response",
  "network.copyBody": "Copy {title} body",
  "network.statusFilter.clientError": "4xx",
  "network.statusFilter.serverError": "5xx",
  "network.statusFilter.failed": "Failed",
  "network.statusFilter.clientErrorTitle": "Client errors (4xx)",
  "network.statusFilter.serverErrorTitle": "Server errors (5xx)",
  "network.statusFilter.failedTitle": "Network failures (no response)",

  // ---------------------------------------------------------------------
  // queries (views/queries/QueriesView.tsx)
  // ---------------------------------------------------------------------
  "queries.command.refetch": "Refetch",
  "queries.command.invalidate": "Invalidate",
  "queries.command.reset": "Reset",
  "queries.command.remove": "Remove",
  "queries.emptyState": "No query cache connected yet. Attach {call} from {module}.",
  "queries.status": "Status",
  "queries.fetchStatus": "Fetch status",
  "queries.observers": "Observers",
  "queries.dataUpdated": "Data updated",
  "queries.invalidated": "Invalidated",
  "queries.invalidatedYes": "yes — refetch pending",
  "queries.copyQueryKey": "Copy query key",
  "queries.editBanner": "Editing the data here, or using Refetch/Invalidate/Reset/Remove, immediately affects the connected app's React Query cache.",
  "queries.data": "Data",
  "queries.copyData": "Copy data",
  "queries.noDataYet": "No data yet.",
  "queries.error": "Error",
  "queries.removeObserversTooltip": "This query has {count} active observer(s) — it may reappear immediately via their automatic refetch.",
  "queries.writeFailed": "The write didn't reach the app.",
  "queries.writeNotApplied": "The app accepted the write but its cache didn't change — this query may be registered under a different hash (a custom queryKeyHashFn), or the app's SDK is older than this desktop.",
  "queries.writeOverwritten": "The app changed this query right after your edit — a refetch (refetchOnWindowFocus, refetchInterval, or a remount with staleTime 0) most likely overwrote it.",

  // ---------------------------------------------------------------------
  // storage (views/storage/StorageView.tsx)
  // ---------------------------------------------------------------------
  "storage.emptyState": "No storage engine connected yet. Attach a storage adapter, e.g. {call} from {module}.",
  "storage.empty": "Empty.",
  "storage.editBanner": "Editing a value here writes immediately to the connected app's storage.",
  "storage.key": "Key",
  "storage.value": "Value",
  "storage.editRawJson": "Edit raw JSON",
  "storage.invalidJson": "Invalid JSON",
  "storage.rowsCount": "{count} rows",
  "storage.noRows": "No rows.",
  "storage.resizeDetailAria": "Resize detail panel",
  "storage.goToAria": "Go to {table}.id = {id}",
  "storage.location.label": "Path",
  "storage.location.copyAria": "Copy path",
  "storage.location.configuredNote": "set by the app, not read from the engine",
  "storage.clear.engineButton": "Clear",
  "storage.clear.tableButton": "Clear table",
  "storage.clear.unsupported": "Clearing isn't supported for this engine/table.",
  "storage.clear.confirmTitle": "Clear {target}?",
  "storage.clear.confirmBody": "This permanently deletes all data in {target} from the connected app. This can't be undone.",
  "storage.clear.confirmPrompt": "Type {target} to confirm.",
  "storage.clear.confirmButton": "Delete permanently",
  "storage.clear.cancelButton": "Cancel",
  "storage.dbFile.exportButton": "Export .db",
  "storage.dbFile.importButton": "Import .db",
  "storage.dbFile.exporting": "Exporting…",
  "storage.dbFile.importing": "Importing…",
  "storage.dbFile.unsupported": "Export/Import unavailable",
  "storage.dbFile.noPath": "No file path reported for this engine.",
  "storage.dbFile.iosPhysicalUnsupported": "Not available for a physical iOS device — the desktop has no way to reach its private storage.",
  "storage.dbFile.platformUnsupported": "Not available for this platform.",
  "storage.dbFile.needsDeviceSelection": "Open the Performance tab once to pick this app's Android device and package, then come back here.",
  "storage.dbFile.exportSuccess": "Exported {count} file(s) to {dir}.",
  "storage.dbFile.importSuccess": "Imported — restart the connected app for the new data to take effect.",
  "storage.dbFile.importConfirmTitle": "Import into {target}?",
  "storage.dbFile.importConfirmBody": "This overwrites {target} in the connected app. This can't be undone, and the app must be restarted for the change to take effect.",
  "storage.dbFile.importConfirmButton": "Overwrite",

  // ---------------------------------------------------------------------
  // graph (views/graph/GraphView.tsx)
  // ---------------------------------------------------------------------
  "graph.emptyState": "No navigation events yet. Call {call} from {module} and navigate to a screen in the app.",
  "graph.screenCount_one": "{count} screen",
  "graph.screenCount_other": "{count} screens",
  "graph.linkCount_one": "{count} link",
  "graph.linkCount_other": "{count} links",
  "graph.clearAria": "Clear navigation graph",
  "graph.resizeDetailAria": "Resize detail panel",
  "graph.visitCount_one": "{count} visit",
  "graph.visitCount_other": "{count} visits",
  "graph.lastSeen": "Last seen {time}",
  "graph.noParams": "No params.",
  "graph.history": "History",
  "graph.noTransitionsYet": "No transitions yet.",
  "graph.start": "(start)",
  "graph.selectScreen": "Select a screen to see its params and history.",
  "graph.noParamsSummary": "no params",

  // ---------------------------------------------------------------------
  // stores (views/stores/StoresView.tsx)
  // ---------------------------------------------------------------------
  "stores.emptyState": "No state store connected yet. Attach a state adapter, e.g. {call} from {module}.",
  "stores.actions": "Actions ({count})",
  "stores.changeCount_one": "{count} change",
  "stores.changeCount_other": "{count} changes",
  "stores.noActionsYet": "No actions yet.",
  "stores.state": "State",
  "stores.copyState": "Copy state",
  "stores.editBanner": "Editing a field here writes immediately to the connected app's store (shallow merge, doesn't replace the whole store).",

  // ---------------------------------------------------------------------
  // performance (views/performance/PerformanceView.tsx)
  // ---------------------------------------------------------------------
  "performance.sampleCount_one": "{count} sample",
  "performance.sampleCount_other": "{count} samples",
  "performance.stallCount_one": "{count} stall",
  "performance.stallCount_other": "{count} stalls",
  "performance.clearAria": "Clear performance data",
  "performance.waitingFirstSample": "Waiting for the first sample…",
  "performance.emptyState": "No performance data yet. Attach {call} from {module}.",
  "performance.stalls": "Stalls",
  "performance.noStalls": "No stalls recorded — the JS thread hasn't blocked for longer than the adapter's threshold.",
  "performance.fps": "fps",

  // ---------------------------------------------------------------------
  // logs (views/logs/LogsView.tsx)
  // ---------------------------------------------------------------------
  "logs.searchPlaceholder": "Search logs…",
  "logs.clearAllAria": "Clear all logs",
  "logs.emptyState": "No console output yet. Attach {call} from {module}.",
  "logs.noMatches": "No matches.",
  "logs.copyLine": "Copy log line",

  // ---------------------------------------------------------------------
  // update banner (components/UpdateBanner.tsx)
  // ---------------------------------------------------------------------
  "update.available": "Spyglass {version} is available",
  "update.updateBtn": "Update",
  "update.later": "Later",
  "update.downloading": "Downloading Spyglass {version}…",
  "update.ready": "Spyglass {version} is ready — restart to finish updating.",
  "update.restartNow": "Restart now",
  "update.error": "Couldn't install the Spyglass {version} update.",
  "update.tryAgain": "Try again",
  "update.dismiss": "Dismiss",

  // ---------------------------------------------------------------------
  // JsonGraph family (components/jsonGraph/*)
  // ---------------------------------------------------------------------
  "jsonInspector.root": "(root)",
  "jsonInspector.fields": "Fields",
  "jsonInspector.field": "Field",
  "jsonInspector.value": "Value",
  "jsonInspector.circularRef": "Circular reference — {label} refers back to an ancestor, nothing to show here.",
  "jsonInspector.thisNode": "this node",
  "jsonValueNode.failedToApply": "Failed to apply — see the inspector column for details",
  "jsonGraph.largePayload": "Large payload — showing tree view instead of a diagram.",
  "jsonGraph.itemCount_one": "[…] {count} item",
  "jsonGraph.itemCount_other": "[…] {count} items",
  "jsonGraph.keyCount_one": "{…} {count} key",
  "jsonGraph.keyCount_other": "{…} {count} keys",

  // ---------------------------------------------------------------------
  // JsonTree (components/JsonTree.tsx)
  // ---------------------------------------------------------------------
  "jsonTree.circular": "[Circular]",
  "jsonTree.anonymous": "anonymous",
  "jsonTree.more": " more",
  "jsonTree.less": " less",

  // ---------------------------------------------------------------------
  // error boundary (components/ErrorBoundary.tsx)
  // ---------------------------------------------------------------------
  "errorBoundary.title": "Something went wrong",
  "errorBoundary.body": "A connected app sent data Spyglass couldn't render. This is usually recoverable — reload the window to continue.",
  "errorBoundary.reload": "Reload",

  // ---------------------------------------------------------------------
  // live-edit banner (components/LiveEditBanner.tsx)
  // ---------------------------------------------------------------------
  "liveEditBanner.dismissAria": "Dismiss notice",

  // ---------------------------------------------------------------------
  // native alert notifications (lib/alerts.ts) — read by formatAlert(),
  // called outside React (the alert runner), so these go through the
  // standalone t(), never useT().
  // ---------------------------------------------------------------------
  "alerts.logTitle": "{app} · {level}",
  "alerts.networkTitle": "{app} · network error",
  "alerts.requestFailed": "request failed",
  "alerts.moreSinceLast": "+{count} more since the last alert",

  // ---------------------------------------------------------------------
  // connection store errors (state/connection.ts) — also outside React.
  // ---------------------------------------------------------------------
  "connection.appDisconnected": "App disconnected",
  "connection.truncatedValue": "This value contains data that was truncated for display (too large/deep/circular) — editing it back into the app isn't safe.",
  "connection.noResponse": "No response from the app (3s). It may have disconnected, or writes are disabled in this build (production).",
  "connection.undefinedValue": "There's no value to write (undefined) — it wouldn't survive the connection to the app.",
} as const;
