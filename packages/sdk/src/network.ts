import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { NetworkRequestPayload, NetworkResponsePayload } from "spyglass-protocol";
import { getCore, type SpyglassCore } from "./core.js";

export interface NetworkAdapterOptions {
  /** Set to false to report method/url/status/timing without request or response bodies. */
  captureBody?: boolean;
}

/**
 * Observes every network call by patching `XMLHttpRequest` and, in a real
 * browser, `fetch` too.
 *
 * The two need different treatment: in React Native, `fetch` is a polyfill
 * implemented on top of `XMLHttpRequest`, so patching both there would
 * double-report every `fetch()` call — patching XHR alone already covers
 * `fetch`, axios (XHR adapter, RN's default) and any other XHR-based
 * library for free. In a *browser*, `fetch` is its own native
 * implementation completely independent of `XMLHttpRequest` — a web app
 * calling `fetch()` directly (very common; no XHR involved at all) would be
 * invisible if only XHR were patched. So: always patch XHR, and patch
 * `fetch` too unless running inside React Native.
 *
 * ```ts
 * import { attachNetwork } from "spyglass-react/network";
 * attachNetwork();
 * ```
 */
export function attachNetwork(options: NetworkAdapterOptions = {}): () => void {
  const core = getCore();
  // Guards against double-patching XHR/fetch — see the equivalent comment
  // in `console.ts`'s `attachConsole`.
  if (!core.markAttached("network")) return () => {};
  core.registerCapability("network");
  const captureBody = options.captureBody ?? true;

  const restoreXhr = patchXHR(core, captureBody);
  const restoreFetch = isReactNativeEnvironment() ? () => {} : patchFetch(core, captureBody);

  return () => {
    restoreXhr();
    restoreFetch();
  };
}

function isReactNativeEnvironment(): boolean {
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  return nav?.product === "ReactNative";
}

// ---------------------------------------------------------------------------
// XMLHttpRequest
// ---------------------------------------------------------------------------

interface XMLHttpRequestWithMeta extends XMLHttpRequest {
  __spyglass?: { method: string; url: string; headers: Record<string, string> };
}

function patchXHR(core: SpyglassCore, captureBody: boolean): () => void {
  const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (!XHR) return () => {};

  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetRequestHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (this: XMLHttpRequestWithMeta, method: string, url: string, ...rest: unknown[]) {
    this.__spyglass = { method, url, headers: {} };
    return (originalOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
  };

  XHR.prototype.setRequestHeader = function (this: XMLHttpRequestWithMeta, name: string, value: string) {
    if (this.__spyglass) this.__spyglass.headers[name] = value;
    return originalSetRequestHeader.call(this, name, value);
  };

  XHR.prototype.send = function (this: XMLHttpRequestWithMeta, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = this.__spyglass;
    if (!meta) return originalSend.call(this, body);

    const requestId = nextRequestId();
    const startedAt = Date.now();

    const requestPayload: NetworkRequestPayload = {
      requestId,
      method: meta.method,
      url: meta.url,
      headers: meta.headers,
      body: captureBody ? safeSerialize(xhrBodyPreview(body)) : undefined,
    };
    core.transport.send(createEnvelope("network/request", core.appId, requestPayload));

    const finish = (error?: string) => {
      sendXhrResponse(core, requestId, startedAt, this, captureBody, error);
    };

    this.addEventListener("load", () => finish());
    this.addEventListener("error", () => finish("Network request failed"));
    this.addEventListener("timeout", () => finish("Network request timed out"));
    this.addEventListener("abort", () => finish("Network request aborted"));

    return originalSend.call(this, body);
  };

  return () => {
    XHR.prototype.open = originalOpen;
    XHR.prototype.setRequestHeader = originalSetRequestHeader;
    XHR.prototype.send = originalSend;
  };
}

function xhrBodyPreview(body: Document | XMLHttpRequestBodyInit | null | undefined): unknown {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  // Document, Blob, ArrayBuffer, FormData, etc. — not worth serializing; describe instead.
  return `[${body.constructor?.name ?? "body"}]`;
}

function sendXhrResponse(
  core: SpyglassCore,
  requestId: string,
  startedAt: number,
  xhr: XMLHttpRequest,
  captureBody: boolean,
  error?: string,
): void {
  const durationMs = Date.now() - startedAt;
  const payload: NetworkResponsePayload = error
    ? { requestId, durationMs, error }
    : {
        requestId,
        status: xhr.status,
        statusText: xhr.statusText,
        ok: xhr.status >= 200 && xhr.status < 300,
        headers: parseRawHeaders(xhr.getAllResponseHeaders?.()),
        body: captureBody ? safeSerialize(safeResponseText(xhr)) : undefined,
        durationMs,
      };
  core.transport.send(createEnvelope("network/response", core.appId, payload));
}

function safeResponseText(xhr: XMLHttpRequest): unknown {
  try {
    return xhr.responseText;
  } catch {
    return undefined;
  }
}

function parseRawHeaders(raw: string | null | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

// ---------------------------------------------------------------------------
// fetch (browsers only — see attachNetwork's doc comment for why)
// ---------------------------------------------------------------------------

type FetchFn = typeof fetch;

function patchFetch(core: SpyglassCore, captureBody: boolean): () => void {
  const original = (globalThis as { fetch?: FetchFn }).fetch;
  if (!original) return () => {};

  const patched: FetchFn = async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = headersToObject(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestId = nextRequestId();
    const startedAt = Date.now();

    const requestPayload: NetworkRequestPayload = {
      requestId,
      method,
      url,
      headers,
      body: captureBody ? safeSerialize(fetchBodyPreview(init?.body)) : undefined,
    };
    core.transport.send(createEnvelope("network/request", core.appId, requestPayload));

    try {
      const response = await original(input, init);
      const durationMs = Date.now() - startedAt;
      let body: unknown;
      if (captureBody) {
        body = await response
          .clone()
          .text()
          .catch(() => undefined);
      }
      const responsePayload: NetworkResponsePayload = {
        requestId,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: headersToObject(response.headers),
        body: body !== undefined ? safeSerialize(body) : undefined,
        durationMs,
      };
      core.transport.send(createEnvelope("network/response", core.appId, responsePayload));
      return response;
    } catch (error) {
      const responsePayload: NetworkResponsePayload = {
        requestId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
      core.transport.send(createEnvelope("network/response", core.appId, responsePayload));
      throw error;
    }
  };

  (globalThis as { fetch: FetchFn }).fetch = patched;

  return () => {
    (globalThis as { fetch: FetchFn }).fetch = original;
  };
}

function fetchBodyPreview(body: BodyInit | null | undefined): unknown {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return `[${(body as { constructor?: { name?: string } }).constructor?.name ?? "body"}]`;
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `req_${Date.now().toString(36)}_${requestCounter}`;
}
