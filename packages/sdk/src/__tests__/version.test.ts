import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "../index.js";

/**
 * `SDK_VERSION` is hand-maintained (see the comment on it in `index.ts`) and
 * sent in every `hello` envelope. Nothing rewrites it automatically on
 * release, so this guards against it drifting from `package.json` — without
 * it, a release would ship a stale version string with no error anywhere.
 */
it("SDK_VERSION matches package.json's version", () => {
  const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  expect(SDK_VERSION).toBe(pkg.version);
});

describe("SDK_VERSION", () => {
  it("is a valid semver-shaped string", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
