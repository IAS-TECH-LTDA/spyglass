/**
 * "Clear caches" (spec 0008) — the only thing any third-party app can
 * actually do about memory pressure on demand. Neither iOS nor Android
 * lets an app ask the OS to release memory back to it (`onTrimMemory`/
 * `didReceiveMemoryWarning` are the OS telling the app, never the other
 * way around) — so this is deliberately scoped to the app's own caches,
 * matching `MemoryClearCachePayload`'s doc comment in the protocol package.
 * No handler registry like `commands.ts`'s storage/state maps — this isn't
 * a per-resource action, `enableInboundCommands` calls it directly.
 */

/**
 * Hermes exposes a forced-GC hook in production builds (undocumented, but
 * confirmed present — see spec 0008's research), reached via
 * `global.gc()`. Guarded rather than assumed: it's not part of any public
 * API surface and could be absent under a different JS engine or a future
 * Hermes build.
 */
function tryRunGc(): boolean {
  const g = globalThis as { gc?: () => void };
  if (typeof g.gc !== "function") return false;
  g.gc();
  return true;
}

/**
 * `expo-image` is an optional peer dependency, reached the same way every
 * other optional adapter in this SDK reaches its own peer dep — a dynamic
 * `import()`, never static, silently skipped if the package isn't
 * installed (same spirit as `detectFramework()`'s `expo-constants` probe).
 * Not every RN app uses `expo-image`; when it isn't installed, `clearCaches`
 * still runs the GC step above, it just has nothing else to do.
 */
async function tryClearImageCaches(): Promise<boolean> {
  try {
    const mod = (await import("expo-image")) as {
      Image?: { clearMemoryCache?: () => Promise<boolean>; clearDiskCache?: () => Promise<boolean> };
    };
    const clearMemoryCache = mod.Image?.clearMemoryCache;
    if (!clearMemoryCache) return false;
    await clearMemoryCache();
    await mod.Image?.clearDiskCache?.();
    return true;
  } catch {
    return false;
  }
}

/** @internal Called by `commands.ts`'s `memory/clear-cache` handler. */
export async function clearCaches(): Promise<void> {
  tryRunGc();
  await tryClearImageCaches();
}
