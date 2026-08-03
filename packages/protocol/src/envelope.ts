import { PROTOCOL_VERSION } from "./constants.js";
import type { AnyEnvelope, MessageType, PayloadByType } from "./types.js";

export function createEnvelope<T extends MessageType>(
  type: T,
  appId: string,
  payload: PayloadByType[T],
): Extract<AnyEnvelope, { type: T }> {
  return {
    v: PROTOCOL_VERSION,
    type,
    appId,
    ts: Date.now(),
    payload,
  } as Extract<AnyEnvelope, { type: T }>;
}

export function encodeEnvelope(envelope: AnyEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Parses and minimally validates a raw WebSocket frame. Returns `null`
 * (instead of throwing) on malformed input so both sides can just log and
 * drop garbage frames rather than crashing the connection.
 */
export function decodeEnvelope(raw: string): AnyEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isAnyEnvelopeShape(parsed)) return null;
  return parsed;
}

function isAnyEnvelopeShape(value: unknown): value is AnyEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === PROTOCOL_VERSION &&
    typeof v.type === "string" &&
    typeof v.appId === "string" &&
    typeof v.ts === "number" &&
    "payload" in v
  );
}
