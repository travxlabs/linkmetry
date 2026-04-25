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

## Product rule

Linkmetry should never pretend to know more than the OS and hardware expose. If a conclusion is inferred, it must carry confidence and evidence.
