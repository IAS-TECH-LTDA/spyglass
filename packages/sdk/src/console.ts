import { createEnvelope, safeSerialize } from "@datamobile/protocol";
import type { LogEntryPayload, LogLevel } from "@datamobile/protocol";
import { getCore } from "./core.js";

export interface ConsoleAdapterOptions {
  /** Defaults to all five levels. */
  levels?: LogLevel[];
}

const DEFAULT_LEVELS: LogLevel[] = ["log", "info", "warn", "error", "debug"];

/**
 * Wraps `console.log/info/warn/error/debug` so every call is both printed
 * normally (Metro's console, `adb logcat`, Xcode's console — whatever the
 * app already logs to) and streamed to the desktop inspector.
 *
 * ```ts
 * import { attachConsole } from "@datamobile/sdk/console";
 * attachConsole();
 * ```
 */
export function attachConsole(options: ConsoleAdapterOptions = {}): () => void {
  const core = getCore();
  core.registerCapability("console");
  const levels = options.levels ?? DEFAULT_LEVELS;

  const originals = new Map<LogLevel, (...args: unknown[]) => void>();

  for (const level of levels) {
    const original = console[level] as (...args: unknown[]) => void;
    originals.set(level, original);

    console[level] = (...args: unknown[]) => {
      original(...args);

      const payload: LogEntryPayload = {
        level,
        message: formatArgs(args),
        args: args.map((arg) => safeSerialize(arg)),
      };
      core.transport.send(createEnvelope("log/entry", core.appId, payload));
    };
  }

  return () => {
    for (const [level, original] of originals) {
      console[level] = original;
    }
  };
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}
