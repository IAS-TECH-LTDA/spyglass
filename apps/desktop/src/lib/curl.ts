export interface CurlSource {
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
}

/**
 * Reconstructs a `curl` command equivalent to the given request. Multi-line
 * (backslash-continued) so the copied command is readable when pasted into
 * a terminal or a README.
 */
export function toCurl(entry: CurlSource): string {
  const parts: string[] = ["curl"];

  if (entry.method && entry.method.toUpperCase() !== "GET") {
    parts.push(`-X ${entry.method.toUpperCase()}`);
  }

  parts.push(shellQuote(entry.url));

  const headers = entry.requestHeaders ?? {};
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H ${shellQuote(`${key}: ${value}`)}`);
  }

  if (entry.requestBody !== undefined) {
    const serialized = typeof entry.requestBody === "string" ? entry.requestBody : JSON.stringify(entry.requestBody);
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (!hasContentType && typeof entry.requestBody !== "string") {
      parts.push(`-H ${shellQuote("Content-Type: application/json")}`);
    }
    parts.push(`--data ${shellQuote(serialized)}`);
  }

  return parts.join(" \\\n  ");
}

/** POSIX-safe single-quote wrapping: the only quoting style that's safe against `$`, backticks, etc. inside the value. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
