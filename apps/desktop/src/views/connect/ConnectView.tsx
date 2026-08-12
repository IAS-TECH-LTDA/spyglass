import { useEffect, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import {
  getAdbStatus,
  getConnectionInfo,
  onAdbStatus,
  retryAdbReverse,
  type AdbStatus,
  type ConnectionInfo,
} from "../../ipc";

type Scenario = "device" | "ios-simulator" | "android-emulator";

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: "device", label: "Physical device" },
  { id: "ios-simulator", label: "iOS Simulator" },
  { id: "android-emulator", label: "Android emulator" },
];

type PackageManager = "npm" | "yarn" | "pnpm";

const PACKAGE_MANAGERS: Array<{ id: PackageManager; label: string }> = [
  { id: "npm", label: "npm" },
  { id: "yarn", label: "yarn" },
  { id: "pnpm", label: "pnpm" },
];

function installCmdFor(pm: PackageManager): string {
  switch (pm) {
    case "npm":
      return "npm i -D spyglass-react";
    case "yarn":
      return "yarn add -D spyglass-react";
    case "pnpm":
      return "pnpm add -D spyglass-react";
  }
}

type StateLib = "redux" | "zustand" | "jotai" | "mobx";

const STATE_LIBS: Array<{ id: StateLib; label: string }> = [
  { id: "redux", label: "Redux" },
  { id: "zustand", label: "Zustand" },
  { id: "jotai", label: "Jotai" },
  { id: "mobx", label: "MobX" },
];

function adapterSnippetFor(lib: StateLib): string {
  switch (lib) {
    case "redux":
      return [
        'import { createSpyglassReduxMiddleware } from "spyglass-react/state/redux";',
        "",
        "const store = configureStore({",
        "  reducer: rootReducer,",
        "  middleware: (getDefault) => getDefault().concat(createSpyglassReduxMiddleware()),",
        "});",
      ].join("\n");
    case "zustand":
      return [
        'import { withSpyglass } from "spyglass-react/state/zustand";',
        "",
        "const useStore = create(withSpyglass((set, get) => ({",
        "  count: 0,",
        "  increment: () => set((s) => ({ count: s.count + 1 })),",
        "})));",
      ].join("\n");
    case "jotai":
      return [
        'import { createStore } from "jotai/vanilla";',
        'import { attachJotai } from "spyglass-react/state/jotai";',
        "",
        "export const store = createStore();",
        'attachJotai(store, [{ atom: countAtom, name: "count" }]);',
      ].join("\n");
    case "mobx":
      return [
        'import * as mobx from "mobx";',
        'import { attachMobx } from "spyglass-react/state/mobx";',
        "",
        "export const store = new RootStore();",
        "attachMobx(mobx, () => store);",
      ].join("\n");
  }
}

function noteFor(scenario: Scenario): string {
  switch (scenario) {
    case "ios-simulator":
      return "Shares this Mac's network — the SDK detects “localhost” automatically.";
    case "android-emulator":
      return "Auto-detected. Spyglass keeps “adb reverse tcp:8098 tcp:8098” applied for you (status below); without adb the SDK falls back to “10.0.2.2”.";
    case "device":
      return "Same Wi-Fi as this Mac. The SDK usually detects this from the Metro URL — pass “host” only if it doesn't.";
  }
}

function snippetFor(scenario: Scenario, host: string | null): string {
  if (scenario === "device" && host) {
    return `init({ appName: "MyApp", host: "${host}" })`;
  }
  return `init({ appName: "MyApp" })`;
}

/**
 * Replaces the desktop's old hardcoded "connect to ws://localhost:8098"
 * empty state. Shown whenever no app is selected — the natural place for
 * connection help, since that's exactly when a dev needs it.
 */
export function ConnectView() {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [adbStatus, setAdbStatus] = useState<AdbStatus | null>(null);
  const [scenario, setScenario] = useState<Scenario>("device");
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [pm, setPm] = useState<PackageManager>("npm");
  const [stateLib, setStateLib] = useState<StateLib>("redux");

  useEffect(() => {
    void refreshConnectionInfo();
    void getAdbStatus().then(setAdbStatus);
    const unlisten = onAdbStatus(setAdbStatus);
    return () => {
      void unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshConnectionInfo() {
    const info = await getConnectionInfo();
    setConnectionInfo(info);
    setSelectedIp((current) => {
      if (current && info.addresses.some((a) => a.ip === current)) return current;
      const primary = info.addresses.find((a) => a.isPrimary) ?? info.addresses[0];
      return primary?.ip ?? null;
    });
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      setAdbStatus(await retryAdbReverse());
    } finally {
      setRetrying(false);
    }
  }

  const port = connectionInfo?.port ?? 8098;
  const host = scenario === "device" ? selectedIp : null;
  const snippet = snippetFor(scenario, host);
  const installCmd = installCmdFor(pm);
  const adapterSnippet = adapterSnippetFor(stateLib);

  return (
    <div className="connect-view">
      <div className="connect-col">
        <h2>No app connected yet</h2>
        <p className="empty-hint">
          Spyglass is listening on <code>ws://0.0.0.0:{port}</code>. Add the SDK to your app and it shows up here.
        </p>

        <div className="connect-step">
          <span className="connect-step-num">1</span>
          <div className="connect-step-body">
            <div>Install the SDK</div>
            <nav className="connect-scenarios">
              {PACKAGE_MANAGERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`storage-chip ${pm === p.id ? "active" : ""}`}
                  style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                  onClick={() => setPm(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </nav>
            <div className="connect-code">
              <code>{installCmd}</code>
              <CopyButton text={installCmd} size="sm" />
            </div>
          </div>
        </div>

        <div className="connect-step">
          <span className="connect-step-num">2</span>
          <div className="connect-step-body">
            <div>Pick your scenario</div>
            <nav className="connect-scenarios">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`storage-chip ${scenario === s.id ? "active" : ""}`}
                  style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                  onClick={() => setScenario(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        <div className="connect-step">
          <span className="connect-step-num">3</span>
          <div className="connect-step-body">
            <div>
              Call <code>init()</code> — usually at the top of <code>App.tsx</code>
            </div>
            <div className="connect-code">
              <code>{snippet}</code>
              <CopyButton text={snippet} size="sm" />
            </div>
            <p className="empty-hint">{noteFor(scenario)}</p>
          </div>
        </div>

        {scenario === "device" && (
          <div className="connect-addresses">
            <div className="connect-addresses-head">
              <span>LAN addresses on this machine</span>
              <button
                type="button"
                className="icon-btn"
                title="Refresh"
                aria-label="Refresh LAN addresses"
                onClick={() => void refreshConnectionInfo()}
              >
                ⟳
              </button>
            </div>
            {connectionInfo && connectionInfo.addresses.length === 0 && (
              <p className="empty-hint">No LAN address found — is this machine on Wi-Fi?</p>
            )}
            {connectionInfo?.addresses.map((addr) => (
              <button
                key={addr.ip}
                type="button"
                className={`connect-addr ${addr.ip === selectedIp ? "selected" : ""}`}
                onClick={() => setSelectedIp(addr.ip)}
              >
                <span className={`dot ${addr.ip === selectedIp ? "dot-on" : "dot-off"}`} />
                <span className="connect-addr-ip">{addr.ip}</span>
                <small className="empty-hint">{addr.interfaceName}</small>
                {addr.isPrimary && <small className="empty-hint">primary</small>}
                <CopyButton text={addr.ip} size="sm" />
              </button>
            ))}
          </div>
        )}

        <div className="connect-step">
          <span className="connect-step-num">4</span>
          <div className="connect-step-body">
            <div>Attach a state adapter (optional)</div>
            <nav className="connect-scenarios">
              {STATE_LIBS.map((lib) => (
                <button
                  key={lib.id}
                  type="button"
                  className={`storage-chip ${stateLib === lib.id ? "active" : ""}`}
                  style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                  onClick={() => setStateLib(lib.id)}
                >
                  {lib.label}
                </button>
              ))}
            </nav>
            <div className="connect-code connect-code-multi">
              <code>{adapterSnippet}</code>
              <CopyButton text={adapterSnippet} size="sm" />
            </div>
            <p className="empty-hint">
              Navigation, storage (AsyncStorage, MMKV, SQLite, Realm, WatermelonDB) and React Query have their
              own adapters — see the SDK README.
            </p>
          </div>
        </div>

        <div className="connect-status">
          <div className="connect-status-row">
            <span className={`dot ${connectionInfo ? "dot-on" : "dot-off"}`} />
            <span>
              Listening on <code>ws://0.0.0.0:{port}</code>
            </span>
          </div>
          <AdbStatusRow status={adbStatus} onRetry={() => void handleRetry()} retrying={retrying} />
        </div>
      </div>
    </div>
  );
}

function AdbStatusRow({ status, onRetry, retrying }: { status: AdbStatus | null; onRetry: () => void; retrying: boolean }) {
  const { label, ok } = describeAdbStatus(status);
  return (
    <div className="connect-status-row">
      <span className={`dot ${ok ? "dot-on" : "dot-off"}`} />
      <span>{label}</span>
      <button type="button" className="icon-btn connect-retry-btn" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

function describeAdbStatus(status: AdbStatus | null): { label: string; ok: boolean } {
  if (!status || status.state === "searching") {
    return { label: "Checking for adb…", ok: false };
  }
  switch (status.state) {
    case "ok":
      return { label: `adb reverse applied · ${status.devices.map((d) => d.serial).join(", ")}`, ok: true };
    case "partial": {
      const failed = status.devices.filter((d) => !d.reversed);
      const okCount = status.devices.length - failed.length;
      const detail = failed.map((d) => `${d.serial} (${d.error ?? "failed"})`).join(", ");
      return { label: `adb reverse applied to ${okCount} of ${status.devices.length} devices — ${detail}`, ok: false };
    }
    case "no-devices":
      return { label: "adb found, no devices attached — starts automatically once one connects", ok: false };
    case "unavailable":
      return { label: status.message ?? "adb not found", ok: false };
    case "error":
      return { label: status.message ?? "adb error", ok: false };
  }
}
