import { createEnvelope } from "@datamobile/protocol";
import type { PerfSamplePayload, PerfStallPayload } from "@datamobile/protocol";
import { getCore } from "./core.js";

export interface PerformanceAdapterOptions {
  /** A single frame slower than this (ms) is reported immediately as `perf/stall`. */
  stallThresholdMs?: number;
  /** A frame slower than this (ms) counts toward `droppedFrames` in the periodic sample — default is ~33.3ms, i.e. a missed 60fps vsync. */
  dropThresholdMs?: number;
  /** How often periodic `perf/sample` summaries are sent, ms. */
  sampleWindowMs?: number;
}

const DEFAULT_STALL_THRESHOLD_MS = 200;
const DEFAULT_DROP_THRESHOLD_MS = 33.3;
const DEFAULT_SAMPLE_WINDOW_MS = 2000;

/**
 * Measures JS-thread frame timing via `requestAnimationFrame`: a rolling
 * FPS/dropped-frame summary every `sampleWindowMs` (`perf/sample`), plus an
 * immediate `perf/stall` any time a single frame blocks for longer than
 * `stallThresholdMs`. Together these are the most actionable,
 * zero-instrumentation signal for "where does the app jank" — no need to
 * wrap components in a `<Profiler>` or hook into React internals.
 *
 * ```ts
 * import { attachPerformance } from "@datamobile/sdk/performance";
 * attachPerformance();
 * ```
 */
export function attachPerformance(options: PerformanceAdapterOptions = {}): () => void {
  const core = getCore();
  core.registerCapability("performance");

  const stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const dropThresholdMs = options.dropThresholdMs ?? DEFAULT_DROP_THRESHOLD_MS;
  const sampleWindowMs = options.sampleWindowMs ?? DEFAULT_SAMPLE_WINDOW_MS;

  let lastFrameTime = Date.now();
  let firstFrame = true;
  let frameCount = 0;
  let maxFrameMs = 0;
  let droppedFrames = 0;
  let windowStart = lastFrameTime;
  let rafHandle: number | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;

    const now = Date.now();
    const frameMs = now - lastFrameTime;
    lastFrameTime = now;

    // The gap between attaching the adapter and the first RAF firing isn't a
    // real frame — skip it so it can't masquerade as a stall/dropped frame.
    if (firstFrame) {
      firstFrame = false;
    } else {
      frameCount++;
      if (frameMs > maxFrameMs) maxFrameMs = frameMs;
      if (frameMs > dropThresholdMs) droppedFrames++;

      if (frameMs > stallThresholdMs) {
        const payload: PerfStallPayload = { durationMs: frameMs };
        core.transport.send(createEnvelope("perf/stall", core.appId, payload));
      }
    }

    const elapsed = now - windowStart;
    if (elapsed >= sampleWindowMs) {
      const payload: PerfSamplePayload = {
        fps: frameCount > 0 ? Math.round((frameCount / elapsed) * 1000) : 0,
        maxFrameMs,
        droppedFrames,
        windowMs: elapsed,
      };
      core.transport.send(createEnvelope("perf/sample", core.appId, payload));
      frameCount = 0;
      maxFrameMs = 0;
      droppedFrames = 0;
      windowStart = now;
    }

    rafHandle = requestAnimationFrame(tick);
  };

  rafHandle = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
  };
}
