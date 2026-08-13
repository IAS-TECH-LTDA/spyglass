import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The desktop app has its own release cycle, independent of the
 * `spyglass-protocol`/`spyglass-react` npm lockstep (see CLAUDE.md's
 * "Publishing" section) — `apps/desktop/package.json`'s `version` is the
 * single source of truth, and `tauri.conf.json` points at it rather than
 * duplicating it (`"version": "../package.json"`). `Cargo.toml`'s own
 * `version` is just crate metadata and doesn't drive the bundle or the
 * updater, but letting it drift is confusing housekeeping debt, so this
 * guards it the same way `packages/sdk/__tests__/version.test.ts` guards
 * `SDK_VERSION` against `package.json`.
 *
 * The release workflow (`.github/workflows/release.yml`) separately guards
 * the `desktop-v*` git tag against this same `package.json` version — this
 * test only covers the two files that live in the working tree.
 */
describe("apps/desktop version bookkeeping", () => {
  const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

  it("package.json has a valid semver-shaped version", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("src-tauri/Cargo.toml's [package] version matches package.json", () => {
    const cargoPath = fileURLToPath(new URL("../../src-tauri/Cargo.toml", import.meta.url));
    const cargo = readFileSync(cargoPath, "utf-8");
    // Cargo.toml has no other `version = "..."` line ahead of `[dependencies]`
    // (dependency versions are written as `name = "2"`, not `version = `),
    // so matching the first occurrence is unambiguous without a TOML parser.
    const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
    expect(match, "couldn't find `version = \"...\"` in Cargo.toml's [package] section").not.toBeNull();
    expect(match?.[1]).toBe(pkg.version);
  });

  it("tauri.conf.json points at package.json rather than duplicating the version", () => {
    const confPath = fileURLToPath(new URL("../../src-tauri/tauri.conf.json", import.meta.url));
    const conf = JSON.parse(readFileSync(confPath, "utf-8")) as { version: string };
    expect(conf.version).toBe("../package.json");
  });
});
