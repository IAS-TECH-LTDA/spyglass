import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { NavStatePayload, NavTransitionPayload } from "spyglass-protocol";
import { getCore } from "../core.js";

/**
 * React Router has no external "ref" the way React Navigation does — the
 * current location only exists inside React, via `useLocation()` — so this
 * adapter is a hook mounted once near your app root, same pattern as
 * `useSpyglassRecoil`.
 *
 * v1 is deliberately simple: one flat route per URL (`name` = pathname,
 * `params` = parsed query string), not the nested route-match tree from
 * React Router v6.4+'s `useMatches()`. Good enough to see "which page am I
 * on" and the transition history; nested-route matches are a natural
 * follow-up, same spirit as the WatermelonDB adapter's "best effort" note.
 *
 * ```tsx
 * function RouterInspectorBridge() {
 *   useSpyglassReactRouter();
 *   return null;
 * }
 *
 * <BrowserRouter>
 *   <RouterInspectorBridge />
 *   <App />
 * </BrowserRouter>
 * ```
 */
export function useSpyglassReactRouter(): void {
  const core = getCore();
  const location = useLocation();
  const lastRoute = useRef<{ key: string; name: string } | undefined>(undefined);

  useEffect(() => {
    core.registerCapability("navigation");
  }, [core]);

  useEffect(() => {
    const key = location.pathname + location.search;
    const params = safeSerialize(Object.fromEntries(new URLSearchParams(location.search))) as Record<string, unknown>;

    const statePayload: NavStatePayload = {
      state: { index: 0, routes: [{ key, name: location.pathname, params }] },
      activeRouteKey: key,
    };
    core.transport.send(createEnvelope("nav/state", core.appId, statePayload));

    if (lastRoute.current?.key !== key) {
      const transitionPayload: NavTransitionPayload = {
        from: lastRoute.current,
        to: { key, name: location.pathname, params },
      };
      core.transport.send(createEnvelope("nav/transition", core.appId, transitionPayload));
      lastRoute.current = { key, name: location.pathname };
    }
  }, [location.pathname, location.search, core]);
}
