import { useMemo, useState } from "react";
import type { PerfSample, PerfStall } from "../../state/connection";
import { useConnectionStore } from "../../state/connection";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 80;
/** FPS value that maps to the top of the chart — a bit above the 60fps target so a perfect run doesn't clip. */
const CHART_FPS_SCALE = 70;
/** How many of the most recent samples to plot. */
const CHART_SAMPLE_COUNT = 60;

export function PerformanceView({ appId }: { appId: string }) {
  const perfSamples = useConnectionStore((s) => s.data[appId]?.perfSamples ?? []);
  const perfStalls = useConnectionStore((s) => s.data[appId]?.perfStalls ?? []);
  const navGraph = useConnectionStore((s) => s.data[appId]?.navGraph);
  const clearPerf = useConnectionStore((s) => s.clearPerf);

  if (perfSamples.length === 0 && perfStalls.length === 0) {
    return (
      <div className="view-empty">
        <p>
          No performance data yet. Attach <code>attachPerformance()</code> from{" "}
          <code>@datamobile/sdk/performance</code>.
        </p>
      </div>
    );
  }

  const latest = perfSamples[0];

  const screenAt = (ts: number): string | undefined => {
    if (!navGraph) return undefined;
    // `transitions` is most-recent-first; the first one at or before `ts` was the active screen then.
    return navGraph.transitions.find((t) => t.ts <= ts)?.to;
  };

  return (
    <div className="perf-view">
      <div className="perf-toolbar">
        <span className="perf-count">
          {perfSamples.length} sample{perfSamples.length === 1 ? "" : "s"} · {perfStalls.length} stall{perfStalls.length === 1 ? "" : "s"}
        </span>
        <button className="icon-btn perf-clear" title="Clear performance data" aria-label="Clear performance data" onClick={() => clearPerf(appId)}>
          <TrashIcon />
        </button>
      </div>

      <div className="perf-body">
        <section className="perf-summary">
          {latest ? (
            <div className="perf-fps-readout">
              <span className={`perf-fps-value perf-fps-${fpsSeverity(latest.fps)}`}>{latest.fps}</span>
              <span className="perf-fps-label">fps</span>
            </div>
          ) : (
            <p className="muted">Waiting for the first sample…</p>
          )}

          {perfSamples.length > 1 && <FpsChart samples={perfSamples} />}
        </section>

        <section className="perf-stalls">
          <h3>Stalls</h3>
          {perfStalls.length === 0 ? (
            <p className="muted">No stalls recorded — the JS thread hasn't blocked for longer than the adapter's threshold.</p>
          ) : (
            <ul className="perf-stall-list">
              {perfStalls.map((stall, i) => (
                <StallRow key={i} stall={stall} screen={screenAt(stall.ts)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StallRow({ stall, screen }: { stall: PerfStall; screen: string | undefined }) {
  return (
    <li className="perf-stall-item">
      <span className={`perf-fps-${stallSeverity(stall.durationMs)}`}>{stall.durationMs}ms</span>
      {screen && <span className="badge">{screen}</span>}
      <span className="perf-stall-time">{new Date(stall.ts).toLocaleString()}</span>
    </li>
  );
}

function FpsChart({ samples }: { samples: PerfSample[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Samples arrive most-recent-first; plot oldest -> newest, left to right.
  const chronological = useMemo(() => [...samples].reverse().slice(-CHART_SAMPLE_COUNT), [samples]);

  const points = chronological.map((s, i) => {
    const x = chronological.length > 1 ? (i / (chronological.length - 1)) * CHART_WIDTH : CHART_WIDTH;
    const y = CHART_HEIGHT - (Math.min(s.fps, CHART_FPS_SCALE) / CHART_FPS_SCALE) * CHART_HEIGHT;
    return { x, y, sample: s };
  });

  const linePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baseline60 = CHART_HEIGHT - (60 / CHART_FPS_SCALE) * CHART_HEIGHT;
  const hovered = hoverIndex !== null ? points[hoverIndex] : undefined;

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
        points.forEach((p, i) => {
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
      <line x1={0} y1={baseline60} x2={CHART_WIDTH} y2={baseline60} className="perf-chart-baseline" />
      <polyline points={linePoints} className="perf-chart-line" fill="none" />
      {hovered && (
        <>
          <line x1={hovered.x} y1={0} x2={hovered.x} y2={CHART_HEIGHT} className="perf-chart-crosshair" />
          <circle cx={hovered.x} cy={hovered.y} r={3} className="perf-chart-dot" />
          <text x={Math.min(hovered.x + 6, CHART_WIDTH - 90)} y={12} className="perf-chart-tooltip">
            {hovered.sample.fps} fps · {new Date(hovered.sample.ts).toLocaleTimeString()}
          </text>
        </>
      )}
    </svg>
  );
}

function fpsSeverity(fps: number): "good" | "warn" | "bad" {
  if (fps >= 50) return "good";
  if (fps >= 30) return "warn";
  return "bad";
}

function stallSeverity(durationMs: number): "warn" | "bad" {
  return durationMs >= 500 ? "bad" : "warn";
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
