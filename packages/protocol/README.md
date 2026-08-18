# spyglass-protocol

![Spyglass](https://raw.githubusercontent.com/IAS-TECH-LTDA/spyglass/main/assets/banner.png)

Shared message types and helpers for the [Spyglass](https://github.com/IAS-TECH-LTDA/spyglass)
SDK↔Desktop WebSocket protocol.

You probably don't need this package directly — it's a dependency of
[`spyglass-react`](https://www.npmjs.com/package/spyglass-react), which
re-exports the pieces most consumers need (`Platform`, `Framework`,
`Capability`, etc.) from its own entry point. Install it explicitly only if
you're building a second client or server that speaks the same protocol.

## What's in here

- `types.ts` — the `Envelope<T>` wire shape and the `PayloadByType` map for
  every message type (`hello`, `nav/state`, `state/action`,
  `storage/snapshot`, `log/entry`, `network/request`, …).
- `envelope.ts` — `createEnvelope`, `encodeEnvelope`/`decodeEnvelope`.
- `serialize.ts` — `safeSerialize`/`hashValue`, bounding payload size so a
  huge or circular value can't blow up the socket.
- `diff.ts` — `diffValues`/`applyPatch`, used to send state updates as diffs
  rather than full snapshots.
- `constants.ts` — `DEFAULT_PORT`, `DEFAULT_HOST`, heartbeat/timeout
  intervals, protocol version.

This package is deliberately dependency-free and has no React Native, Tauri
or Node-specific code — it's imported directly by both the SDK (RN runtime)
and the desktop app's webview (browser runtime).

## Versioning

The desktop app's Rust side hand-mirrors these types (`serde(rename_all =
"camelCase")`) — a shape change here needs a matching Rust edit in the
desktop app's `registry.rs`. `spyglass-react` depends on this package via
`workspace:^` in this monorepo, which resolves to a real semver range
(`^<version>`) once published.

## License

MIT
