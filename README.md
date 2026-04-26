# Linkmetry

Cross-platform desktop diagnostic tool for USB devices, external drives, cables, ports, and connection bottlenecks.

## Current status

Phase 0 prototype. The first target is a Linux CLI that inspects USB devices through sysfs and emits normalized JSON.

## Goals

- Detect connected USB devices
- Show vendor/product/model/path/topology details where available
- Surface negotiated speed when the OS exposes it
- Separate detected facts from inferred verdicts
- Keep the core model cross-platform from day one

## Workspace layout

```text
crates/core            Shared models, evidence, verdicts
crates/platform-linux  Linux sysfs adapter
crates/cli             Internal prototype CLI
```

## First command

```bash
cargo run -p linkmetry-cli -- inspect
```

Optional pretty JSON:

```bash
cargo run -p linkmetry-cli -- inspect --pretty
```

Storage correlation prototype:

```bash
cargo run -p linkmetry-cli -- storage --pretty
```


## UI prototype

A first testable web UI lives in `apps/web`. It now renders live USB inventory plus storage card data from the Rust CLI through a small local API bridge.

```bash
pnpm install
pnpm dev
```

Open `http://trav-dev:9000/` (or `http://192.168.4.67:9000/`) to test the current live UI preview. The preview serves the built web UI plus `/api/scan`, which combines `linkmetry-cli inspect` and `linkmetry-cli storage-cards` against Linux sysfs. Port 8080 is reserved for Open WebUI on trav-dev.

## Product rule

Linkmetry should never pretend to know more than the OS and hardware expose. If a conclusion is inferred, it must carry confidence and evidence.


Live scan APIs:

```bash
cargo run -p linkmetry-cli -- inspect --pretty
cargo run -p linkmetry-cli -- storage-cards --pretty
pnpm serve:live
```

Read-only file benchmark:

```bash
cargo run -p linkmetry-cli -- bench-read --iterations 3 --pretty /path/to/large/file
```

Combined storage diagnosis:

```bash
cargo run -p linkmetry-cli -- diagnose-storage --iterations 3 --pretty /path/to/large/file
```
