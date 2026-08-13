import type { StorageEngine } from "spyglass-protocol";
import type { AppData, NetworkEntry } from "../state/connection";

/**
 * Heuristic Network → Queries/Storage correlation (spec 0011): given a
 * network request, guesses which cached queries and storage keys hold data
 * that request produced, so `NetworkView` can point the user at where they
 * can actually edit that data (Queries/Storage), without either side of the
 * protocol ever being told about the other.
 *
 * Two signals, combined the same way `inferForeignKeys.ts` combines its
 * own: token overlap between the request's URL path and the candidate's
 * `queryKey`/storage key is *required* every time; the device-clock timing
 * window (`entry.startedAt + durationMs` vs. the candidate's last-changed
 * timestamp — both already on the same clock, see `AppData.queriesMeta`'s
 * doc comment) is an *additional* filter used only to break a tie between
 * two equally-strong token matches. When ambiguity survives both signals,
 * this returns nothing for that domain rather than guessing — a wrong link
 * here would mislead someone into editing the wrong query/key, which is
 * worse than the section simply not appearing.
 */

export const MIN_TOKEN_LENGTH = 3;
/** Path segments too generic to carry any signal on their own — kept short and hand-picked rather than a stopword list, since a false NEGATIVE here (missing a real match) is cheap and a false POSITIVE (a bogus link) is not. */
const STOPWORDS = new Set(["api", "www", "com", "org", "net", "http", "https", "v1", "v2", "v3"]);
/** How close a response and a query/storage change need to land to count as timing-confirmed — generous enough to survive a stalled JS thread, tight enough not to start matching unrelated activity. */
const TIMING_WINDOW_MS = 5000;

export interface NetworkCorrelation {
  queries: Array<{ queryHash: string; queryKey: unknown[] }>;
  storage: Array<{ engine: StorageEngine; dbName?: string; key: string }>;
}

const EMPTY_CORRELATION: NetworkCorrelation = { queries: [], storage: [] };

function tokenize(input: string): string[] {
  return input
    .split(/[/\-_.:]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0)
    // Numeric tokens (ids) skip the length filter — "42" is a strong,
    // distinctive signal no matter how short; "api"/"v1" are the kind of
    // short token that actually needs filtering, and those aren't numeric.
    .filter((t) => /^\d+$/.test(t) || (t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t)));
}

function pathTokens(url: string): Set<string> {
  try {
    const { pathname } = new URL(url, "http://_.invalid");
    return new Set(tokenize(pathname));
  } catch {
    return new Set();
  }
}

function queryKeyTokens(key: unknown[]): Set<string> {
  const tokens: string[] = [];
  for (const part of key) {
    if (typeof part === "string") tokens.push(...tokenize(part));
    else if (typeof part === "number") tokens.push(...tokenize(String(part)));
    else if (part !== null && part !== undefined) tokens.push(...tokenize(JSON.stringify(part)));
  }
  return new Set(tokens);
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

interface Candidate<T> {
  value: T;
  overlap: number;
  withinWindow: boolean;
}

/**
 * Token overlap is mandatory (candidates with `overlap === 0` never reach
 * this function); timing only disambiguates a tie. If any candidate is
 * timing-confirmed, only timing-confirmed candidates compete for "best" —
 * an unconfirmed token match loses to a confirmed one even with equal
 * overlap. Ties that survive that (including "nobody's timing-confirmed
 * and two+ are tied on tokens") resolve to no match at all.
 */
function pickBest<T>(candidates: Candidate<T>[]): T[] {
  if (candidates.length === 0) return [];
  const timed = candidates.filter((c) => c.withinWindow);
  const pool = timed.length > 0 ? timed : candidates;
  const maxOverlap = Math.max(...pool.map((c) => c.overlap));
  const top = pool.filter((c) => c.overlap === maxOverlap);
  return top.length === 1 ? [top[0].value] : [];
}

export function correlateNetworkEntry(
  entry: NetworkEntry,
  appData: Pick<AppData, "queries" | "queriesMeta" | "storage" | "storageMeta">,
): NetworkCorrelation {
  if (entry.url === "?") return EMPTY_CORRELATION; // orphan response, no real request to correlate against

  const urlTokens = pathTokens(entry.url);
  if (urlTokens.size === 0) return EMPTY_CORRELATION;

  const responseAt = entry.startedAt + (entry.durationMs ?? 0);

  const queryCandidates: Candidate<{ queryHash: string; queryKey: unknown[] }>[] = [];
  for (const query of Object.values(appData.queries)) {
    const overlap = intersectionSize(urlTokens, queryKeyTokens(query.queryKey));
    if (overlap === 0) continue;
    const lastChangedAt = appData.queriesMeta[query.queryHash]?.lastChangedAt;
    const withinWindow = lastChangedAt !== undefined && Math.abs(lastChangedAt - responseAt) <= TIMING_WINDOW_MS;
    queryCandidates.push({ value: { queryHash: query.queryHash, queryKey: query.queryKey }, overlap, withinWindow });
  }

  const storageCandidates: Candidate<{ engine: StorageEngine; dbName?: string; key: string }>[] = [];
  for (const engine of Object.keys(appData.storage) as StorageEngine[]) {
    const snapshot = appData.storage[engine];
    for (const kv of snapshot?.entries ?? []) {
      const overlap = intersectionSize(urlTokens, new Set(tokenize(kv.key)));
      if (overlap === 0) continue;
      const lastChangedAt = appData.storageMeta[engine]?.[kv.key];
      const withinWindow = lastChangedAt !== undefined && Math.abs(lastChangedAt - responseAt) <= TIMING_WINDOW_MS;
      storageCandidates.push({ value: { engine, dbName: snapshot?.dbName, key: kv.key }, overlap, withinWindow });
    }
  }

  return { queries: pickBest(queryCandidates), storage: pickBest(storageCandidates) };
}
