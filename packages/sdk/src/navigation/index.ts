import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { SpyglassNavState, SpyglassRoute, NavTransitionPayload } from "spyglass-protocol";
import { getCore } from "../core.js";

/**
 * The subset of React Navigation's `NavigationContainerRef` this adapter
 * needs. Kept minimal and structural so we don't depend on
 * `@react-navigation/native`'s types at build time (it's an optional peer).
 */
export interface NavigationContainerRefLike {
  // Zero-arg callback on purpose: we never read the event payload (state is
  // re-read via `getRootState()`/`getCurrentRoute()` below), and this keeps
  // the type assignable from React Navigation's real, more specific
  // `EventListenerCallback` without depending on its types.
  addListener(event: "state", callback: () => void): () => void;
  getRootState(): RNNavState | undefined;
  getCurrentRoute(): { key: string; name: string; params?: object } | undefined;
}

/**
 * Shape of React Navigation's internal state tree (stack/tab/drawer,
 * nested). `index` is optional to match React Navigation's `PartialState`
 * (nested navigators can report a not-yet-resolved state before their first
 * render); `toSpyglassNavState` below defaults it to `0`.
 */
interface RNNavState {
  index?: number;
  routeNames?: string[];
  routes: RNNavRoute[];
}

/**
 * `key`/`name` are optional to match React Navigation's `PartialRoute`
 * (used for not-yet-resolved nested navigator state) — `toSpyglassRoute`
 * below fills in placeholders when they're missing.
 */
interface RNNavRoute {
  key?: string;
  name?: string;
  // `object` rather than `Record<string, unknown>`: React Navigation's real
  // route params type has no index signature, so a `Record` requirement
  // would reject it structurally even though every route param bag is a
  // plain object at runtime.
  params?: object;
  state?: RNNavState;
}

export interface AttachNavigationOptions {
  /** Skip sending the full state tree on every transition; only send the lightweight `nav/transition`. */
  transitionOnly?: boolean;
}

/**
 * Attaches to a React Navigation `NavigationContainer` ref (or an Expo
 * Router equivalent, which exposes the same ref shape) and streams:
 *  - `nav/state` — the full navigation tree, on attach and after every change.
 *  - `nav/transition` — a lightweight from/to event, for animating the graph.
 *
 * Usage:
 * ```tsx
 * const navigationRef = useNavigationContainerRef();
 * useEffect(() => attachNavigation(navigationRef.current!), []);
 * ```
 */
export function attachNavigation(
  ref: NavigationContainerRefLike,
  options: AttachNavigationOptions = {},
): () => void {
  const core = getCore();
  core.registerCapability("navigation");

  let lastRoute: { key: string; name: string } | undefined;

  const emitState = () => {
    const rootState = ref.getRootState();
    if (!rootState) return;

    const state = toSpyglassNavState(rootState);
    const activeRoute = ref.getCurrentRoute();
    core.transport.send(
      createEnvelope("nav/state", core.appId, {
        state,
        activeRouteKey: activeRoute?.key ?? "",
      }),
    );
  };

  const emitTransition = () => {
    const current = ref.getCurrentRoute();
    if (!current) return;
    if (lastRoute?.key === current.key) return;

    const payload: NavTransitionPayload = {
      from: lastRoute,
      to: { key: current.key, name: current.name, params: safeSerialize(current.params) as Record<string, unknown> },
    };
    core.transport.send(createEnvelope("nav/transition", core.appId, payload));
    lastRoute = { key: current.key, name: current.name };
  };

  // Initial snapshot — the desktop should see the current screen immediately
  // on connect, not just future transitions.
  emitState();
  emitTransition();

  const unsubscribe = ref.addListener("state", () => {
    emitTransition();
    if (!options.transitionOnly) emitState();
  });

  return unsubscribe;
}

function toSpyglassNavState(state: RNNavState): SpyglassNavState {
  return {
    index: state.index ?? 0,
    routeNames: state.routeNames,
    routes: state.routes.map(toSpyglassRoute),
  };
}

function toSpyglassRoute(route: RNNavRoute): SpyglassRoute {
  return {
    key: route.key ?? "unknown",
    name: route.name ?? "Unknown",
    params: route.params ? (safeSerialize(route.params) as Record<string, unknown>) : undefined,
    state: route.state ? toSpyglassNavState(route.state) : undefined,
  };
}
