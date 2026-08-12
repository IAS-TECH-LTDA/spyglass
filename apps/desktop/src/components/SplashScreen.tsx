/**
 * Launch splash — covers the brief window between the window opening and
 * the initial app list / cached-message hydration finishing (see the
 * `listApps().then(...)` effect in App.tsx), so there's no flash of an
 * empty "Waiting for an app…" shell before data settles.
 *
 * `ready` flips once loading actually finishes, but the splash stays up
 * for at least MIN_VISIBLE_MS regardless — on a fast local reconnect that
 * resolves in a few ms, popping the splash on and back off again would
 * read as a glitch, not a loading state. Unmounts only after the fade-out
 * transition finishes, so there's no hard cut to the real UI.
 */
import { useEffect, useState } from "react";

const MIN_VISIBLE_MS = 650;
const FADE_MS = 400;

export function SplashScreen({ ready }: { ready: boolean }): JSX.Element | null {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (ready && minTimeElapsed) setFadingOut(true);
  }, [ready, minTimeElapsed]);

  useEffect(() => {
    if (!fadingOut) return;
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [fadingOut]);

  if (!mounted) return null;

  return (
    <div className={`splash ${fadingOut ? "splash-out" : ""}`} style={{ "--splash-fade-ms": `${FADE_MS}ms` } as React.CSSProperties}>
      <div className="splash-emblem" role="img" aria-label="Spyglass">
        {/*
          Three stacked copies of the same flat emblem.png, each clipped to
          a different concentric circle and animated independently — the
          source art has no separate layers (it's a flattened screenshot,
          and there's no vectorizing tool in this environment to split it),
          so this simulates independently-moving rings by having each
          layer's circular "window" reveal only its own rotation of the
          full image. Outer band is the HUD ring, middle band is the thin
          white ring, and the innermost band (shutter + "S") only oscillates
          rather than spinning continuously — keeps the S from reading
          upside down mid-animation.
        */}
        <div className="splash-ring splash-ring-outer" />
        <div className="splash-ring splash-ring-mid" />
        <div className="splash-ring splash-ring-inner" />
      </div>
    </div>
  );
}
