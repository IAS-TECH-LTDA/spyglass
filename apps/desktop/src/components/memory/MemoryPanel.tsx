import { useEffect, useMemo, useState } from "react";
import { useConnectionStore } from "../../state/connection";
import type { PendingCacheClear } from "../../state/connection";
import { useT } from "../../i18n";
import { LiveEditBanner } from "../LiveEditBanner";
import {
  findSimulatorPid,
  listBootedSimulators,
  listThirdPartyPackages,
  readAppMemory,
  readSimulatorMemory,
  readSystemMemory,
  suggestForegroundPackage,
  getAdbStatus,
  onAdbStatus,
} from "../../ipc";
import type { AdbDevice, AppMemoryInfo, ForegroundSuggestion, SimulatorInfo, SystemMemoryInfo } from "../../ipc";

/**
 * Memory/swap panel (spec 0008). Deliberately pull-based, not part of the
 * SDK<->Desktop envelope protocol like everything else in this app — the
 * numbers come straight from `adb`/`footprint` on the desktop side, so
 * there's nothing to attach in the connected app at all. Every poll here
 * only runs while this component is mounted (an effect's cleanup clears the
 * interval on unmount) — switching tabs stops it, matching spec 0008's CA7.
 */

const POLL_INTERVAL_MS = 2000;
const HISTORY_LIMIT = 60;
const CHART_WIDTH = 600;
const CHART_HEIGHT = 80;

interface MemoryPoint {
  ts: number;
  valueMb: number;
  /** Android-only — omitted entirely on iOS, where the concept doesn't apply (spec 0008's Fora de escopo). */
  swapMb?: number;
}

function kbToMb(kb: number | undefined): number | undefined {
  return kb === undefined ? undefined : kb / 1024;
}

function bytesToMb(bytes: number | undefined): number | undefined {
  return bytes === undefined ? undefined : bytes / 1024 / 1024;
}

function formatMb(mb: number | undefined): string {
  return mb === undefined ? "—" : `${mb.toFixed(0)} MB`;
}

export function MemoryPanel({ appId }: { appId: string }) {
  const { t } = useT();
  const platform = useConnectionStore((s) => s.apps[appId]?.platform);

  return (
    <div className="memory-panel">
      <div className="memory-panel-head">
        <h3>{t("memory.title")}</h3>
        <ClearCachesButton appId={appId} />
      </div>

      {platform === "android" && <AndroidMemoryPanel appId={appId} />}
      {platform === "ios" && <IosMemoryPanel appId={appId} />}
      {platform !== "android" && platform !== "ios" && <p className="muted">{t("memory.notAvailable")}</p>}
    </div>
  );
}

/**
 * "Clear caches" (spec 0008) — only rendered when the connected app
 * advertises `memory:clear-cache` (dev-only build with `allowRemoteWrites`
 * on), same "don't show a control that can only time out" reasoning as
 * `StorageView`'s `canWrite` gate.
 */
function ClearCachesButton({ appId }: { appId: string }) {
  const { t } = useT();
  const canClear = useConnectionStore((s) => s.apps[appId]?.capabilities.includes("memory:clear-cache") ?? false);
  const sendClearCache = useConnectionStore((s) => s.sendClearCache);
  const pendingCacheClears = useConnectionStore((s) => s.data[appId]?.pendingCacheClears);

  const latest = useMemo(() => {
    if (!pendingCacheClears) return undefined;
    let result: PendingCacheClear | undefined;
    for (const c of Object.values(pendingCacheClears)) {
      if (!result || c.sentAt > result.sentAt) result = c;
    }
    return result;
  }, [pendingCacheClears]);

  if (!canClear) return null;

  return (
    <div className="memory-clear-caches-wrap">
      <LiveEditBanner noticeId="memory-clear-cache">{t("memory.clearCaches.notice")}</LiveEditBanner>
      <div className="memory-clear-caches live-edit-accent">
        <button
          type="button"
          className="memory-clear-caches-btn"
          title={t("memory.clearCaches.tooltip")}
          disabled={latest?.status === "pending"}
          onClick={() => sendClearCache(appId)}
        >
          {t("memory.clearCaches.button")}
        </button>
        {latest?.status && <span className={`jgn-status-dot jgn-status-dot-${latest.status}`} title={latest.error ?? latest.status} />}
      </div>
    </div>
  );
}

function AndroidMemoryPanel({ appId }: { appId: string }) {
  const { t } = useT();
  const serialKey = `dm:memory-android-serial:${appId}`;
  const packageKey = `dm:memory-android-package:${appId}`;

  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [serial, setSerial] = useState<string | null>(() => localStorage.getItem(serialKey));
  const [packages, setPackages] = useState<string[]>([]);
  const [packageName, setPackageName] = useState<string | null>(() => localStorage.getItem(packageKey));
  const [suggestion, setSuggestion] = useState<ForegroundSuggestion | null>(null);
  const [systemMemory, setSystemMemory] = useState<SystemMemoryInfo | null>(null);
  const [appMemory, setAppMemory] = useState<AppMemoryInfo | null>(null);
  const [history, setHistory] = useState<MemoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getAdbStatus().then((status) => setDevices(status.devices.filter((d) => d.state === "device")));
    onAdbStatus((status) => setDevices(status.devices.filter((d) => d.state === "device"))).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // Auto-pick when there's exactly one candidate device — otherwise the
  // user has to choose (spec 0008: deliberately no cross-device guessing).
  useEffect(() => {
    if (serial || devices.length !== 1) return;
    setSerial(devices[0].serial);
  }, [devices, serial]);

  useEffect(() => {
    if (serial) localStorage.setItem(serialKey, serial);
  }, [serial, serialKey]);

  useEffect(() => {
    if (!serial) return;
    setPackages([]);
    setSuggestion(null);
    listThirdPartyPackages(serial)
      .then(setPackages)
      .catch((err) => setError(String(err)));
    // Best-effort only — see suggestForegroundPackage's own doc comment for
    // why this can't be trusted as authoritative (Expo Go, split-screen).
    suggestForegroundPackage(serial)
      .then(setSuggestion)
      .catch(() => {});
  }, [serial]);

  useEffect(() => {
    if (packageName) localStorage.setItem(packageKey, packageName);
  }, [packageName, packageKey]);

  useEffect(() => {
    setHistory([]);
  }, [serial, packageName]);

  useEffect(() => {
    if (!serial || !packageName) return;
    let cancelled = false;
    const tick = () => {
      Promise.all([readSystemMemory(serial), readAppMemory(serial, packageName)])
        .then(([sys, app]) => {
          if (cancelled) return;
          setSystemMemory(sys);
          setAppMemory(app);
          setError(null);
          const valueMb = kbToMb(app.totalRssKb);
          if (valueMb !== undefined) {
            setHistory((prev) => [...prev, { ts: Date.now(), valueMb, swapMb: kbToMb(app.totalSwapPssKb) }].slice(-HISTORY_LIMIT));
          }
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serial, packageName]);

  return (
    <>
      <div className="memory-picker">
        <label>
          {t("memory.device")}
          <select value={serial ?? ""} onChange={(e) => setSerial(e.target.value || null)}>
            <option value="" disabled>
              {t("memory.selectDevice")}
            </option>
            {devices.map((d) => (
              <option key={d.serial} value={d.serial}>
                {d.serial}
              </option>
            ))}
          </select>
        </label>

        {serial && (
          <label>
            {t("memory.package")}
            <select value={packageName ?? ""} onChange={(e) => setPackageName(e.target.value || null)}>
              <option value="" disabled>
                {t("memory.selectPackage")}
              </option>
              {packages.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}

        {suggestion && suggestion.package !== packageName && (
          <button type="button" className="memory-suggestion" onClick={() => setPackageName(suggestion.package)}>
            {t("memory.useSuggested", { package: suggestion.package })}
          </button>
        )}
      </div>

      {error && <p className="memory-error">{error}</p>}

      {systemMemory && appMemory && (
        <>
          <div className="memory-readouts">
            <MemoryReadout label={t("memory.deviceTotal")} value={formatMb(kbToMb(systemMemory.totalKb))} />
            <MemoryReadout label={t("memory.deviceAvailable")} value={formatMb(kbToMb(systemMemory.availableKb))} />
            <MemoryReadout label={t("memory.appPhysical")} value={formatMb(kbToMb(appMemory.totalRssKb))} />
            <MemoryReadout label={t("memory.appSwap")} value={formatMb(kbToMb(appMemory.totalSwapPssKb))} />
          </div>
          {history.length > 1 && <MemoryChart points={history} />}
        </>
      )}
    </>
  );
}

function IosMemoryPanel({ appId }: { appId: string }) {
  const { t } = useT();
  const udidKey = `dm:memory-ios-udid:${appId}`;
  const nameKey = `dm:memory-ios-name:${appId}`;

  const [simulators, setSimulators] = useState<SimulatorInfo[]>([]);
  const [simulatorsError, setSimulatorsError] = useState<string | null>(null);
  const [udid, setUdid] = useState<string | null>(() => localStorage.getItem(udidKey));
  const [bundleOrName, setBundleOrName] = useState<string>(() => localStorage.getItem(nameKey) ?? "");
  const [pid, setPid] = useState<number | null>(null);
  const [memory, setMemory] = useState<{ physFootprintMb?: number } | null>(null);
  const [history, setHistory] = useState<MemoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only registered on macOS (see ios_memory.rs) — rejects everywhere
    // else, which is expected, not a real error to alarm the user over.
    listBootedSimulators()
      .then(setSimulators)
      .catch(() => setSimulatorsError(t("memory.simulatorMacOnly")));
  }, []);

  useEffect(() => {
    if (udid) localStorage.setItem(udidKey, udid);
  }, [udid, udidKey]);

  useEffect(() => {
    if (bundleOrName) localStorage.setItem(nameKey, bundleOrName);
  }, [bundleOrName, nameKey]);

  useEffect(() => {
    setHistory([]);
    setPid(null);
  }, [udid, bundleOrName]);

  useEffect(() => {
    if (!udid || !bundleOrName) return;
    let cancelled = false;
    findSimulatorPid(udid, bundleOrName)
      .then((found) => {
        if (!cancelled) setPid(found);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [udid, bundleOrName]);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    const tick = () => {
      readSimulatorMemory(pid)
        .then((info) => {
          if (cancelled) return;
          const physFootprintMb = bytesToMb(info.physFootprintBytes);
          setMemory({ physFootprintMb });
          setError(null);
          if (physFootprintMb !== undefined) {
            setHistory((prev) => [...prev, { ts: Date.now(), valueMb: physFootprintMb }].slice(-HISTORY_LIMIT));
          }
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pid]);

  return (
    <>
      <div className="memory-picker">
        <label>
          {t("memory.simulator")}
          <select value={udid ?? ""} onChange={(e) => setUdid(e.target.value || null)}>
            <option value="" disabled>
              {t("memory.selectSimulator")}
            </option>
            {simulators.map((s) => (
              <option key={s.udid} value={s.udid}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {udid && (
          <label>
            {t("memory.appBundleLabel")}
            <input type="text" value={bundleOrName} onChange={(e) => setBundleOrName(e.target.value)} placeholder="MyApp" />
          </label>
        )}
      </div>

      {simulatorsError && <p className="muted">{simulatorsError}</p>}
      {!simulatorsError && simulators.length === 0 && <p className="muted">{t("memory.noSimulator")}</p>}
      {error && <p className="memory-error">{error}</p>}
      {udid && bundleOrName && !pid && !error && <p className="muted">{t("memory.waitingForSimApp")}</p>}

      {memory && (
        <>
          <div className="memory-readouts">
            <MemoryReadout label={t("memory.appPhysFootprint")} value={formatMb(memory.physFootprintMb)} />
          </div>
          {history.length > 1 && <MemoryChart points={history} />}
        </>
      )}

      <p className="memory-physical-note">{t("memory.physicalNote")}</p>
    </>
  );
}

function MemoryReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-readout">
      <span className="memory-readout-label">{label}</span>
      <span className="memory-readout-value">{value}</span>
    </div>
  );
}

/** Reuses the FPS chart's exact visual vocabulary (`.perf-chart*` classes in styles.css) — same shape of problem (a short time series in a small SVG), no reason to invent new CSS for it. Auto-scaled to the series' own max (unlike the FPS chart's fixed 70fps scale), since memory usage ranges from tens of MB to several GB. */
function MemoryChart({ points }: { points: MemoryPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxMb = Math.max(...points.map((p) => p.valueMb), 1);
  const scaled = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * CHART_WIDTH : CHART_WIDTH;
    const y = CHART_HEIGHT - (p.valueMb / maxMb) * CHART_HEIGHT;
    return { x, y, point: p };
  });
  const linePoints = scaled.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const hovered = hoverIndex !== null ? scaled[hoverIndex] : undefined;

  return (
    <svg
      className="perf-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const relX = ((e.clientX - rect.left) / rect.width) * CHART_WIDTH;
        let nearest = 0;
        let nearestDist = Infinity;
        scaled.forEach((p, i) => {
          const d = Math.abs(p.x - relX);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = i;
          }
        });
        setHoverIndex(nearest);
      }}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <polyline points={linePoints} className="perf-chart-line" fill="none" />
      {hovered && (
        <>
          <line x1={hovered.x} y1={0} x2={hovered.x} y2={CHART_HEIGHT} className="perf-chart-crosshair" />
          <circle cx={hovered.x} cy={hovered.y} r={3} className="perf-chart-dot" />
          <text x={Math.min(hovered.x + 6, CHART_WIDTH - 140)} y={12} className="perf-chart-tooltip">
            {hovered.point.valueMb.toFixed(0)} MB
            {hovered.point.swapMb !== undefined ? ` · swap ${hovered.point.swapMb.toFixed(0)} MB` : ""} ·{" "}
            {new Date(hovered.point.ts).toLocaleTimeString()}
          </text>
        </>
      )}
    </svg>
  );
}
