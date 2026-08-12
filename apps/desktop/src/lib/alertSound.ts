/**
 * Alert sound, synthesized with Web Audio rather than an audio asset file —
 * the repo has no binary assets and no `public/`/`src/assets/` convention
 * yet, and this is ~30 lines instead of the first bundled `.wav`/`.mp3`. To
 * swap in a real sound later: drop the file under `src/assets/`, `import
 * url from "../assets/alert.wav"` (Vite handles it natively), and replace
 * the body of `playAlertSound()` — this module's exported surface doesn't
 * need to change.
 */

let ctx: AudioContext | null = null;
let primed = false;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Impl = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
    .AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Impl) return null;
  ctx = new Impl();
  return ctx;
}

/**
 * Autoplay policies start an `AudioContext` suspended until the page has
 * seen a user gesture. Alerts are always triggered by an async WebSocket
 * message, never a click — so resume the context on the first gesture of
 * the session and keep it warm. Call once, e.g. from `App.tsx`'s mount
 * effect. Safe to call from a non-DOM environment (tests): no-ops.
 */
export function primeAudio(): void {
  if (primed || typeof window === "undefined") return;
  primed = true;

  const resume = () => {
    getContext()?.resume().catch(() => {
      // Nothing to do — playAlertSound() will simply produce no sound if
      // the context never resumes, same as any other autoplay-blocked case.
    });
  };
  window.addEventListener("pointerdown", resume, { once: true, capture: true });
  window.addEventListener("keydown", resume, { once: true, capture: true });
}

const BEEP_FREQUENCY_HZ = 1046.5; // C6 — cuts through more than a lower tone
const BEEP_DURATION_S = 0.11;
const BEEP_GAP_S = 0.14; // start-to-start spacing between the two beeps
const PEAK_GAIN = 0.35;

/**
 * A sharp double-beep ("beep-beep"), square wave for a more piercing,
 * alarm-like tone than a sine — the previous single soft sine blip read as
 * too subtle to notice. Two short beeps also read more clearly as "alert"
 * than one, similar to a standard OS error chime.
 */
export function playAlertSound(): void {
  const audioCtx = getContext();
  if (!audioCtx || audioCtx.state !== "running") return;

  const now = audioCtx.currentTime;
  playBeep(audioCtx, now);
  playBeep(audioCtx, now + BEEP_GAP_S);
}

function playBeep(audioCtx: AudioContext, start: number): void {
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(BEEP_FREQUENCY_HZ, start);

  // Gain-ramped (not a hard on/off) to avoid a click at the start/end.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + BEEP_DURATION_S);

  oscillator.connect(gain).connect(audioCtx.destination);
  oscillator.onended = () => oscillator.disconnect();
  oscillator.start(start);
  oscillator.stop(start + BEEP_DURATION_S);
}
