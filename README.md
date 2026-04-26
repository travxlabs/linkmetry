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

A first testable web UI lives in `apps/web`. It renders the Rust `DeviceCard`/storage diagnosis shape with a sample Samsung T7 result while the desktop bridge is still being designed.

```bash
pnpm install
pnpm dev
```

Open the Vite URL (currently `http://localhost:5174/`) to test the device card, benchmark panel, and evidence section.

## Product rule

Linkmetry should never pretend to know more than the OS and hardware expose. If a conclusion is inferred, it must carry confidence and evidence.

Read-only file benchmark:

```bash
cargo run -p linkmetry-cli -- bench-read --iterations 3 --pretty /path/to/large/file
```

Combined storage diagnosis:

```bash
cargo run -p linkmetry-cli -- diagnose-storage --iterations 3 --pretty /path/to/large/file
```
