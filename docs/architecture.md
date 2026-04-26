# Linkmetry Architecture

## Principle

Rust owns detection, probing, benchmarking, inference, and normalized results. The desktop UI renders state and triggers actions.

## Crates

### `linkmetry-core`
Shared product model:

- `DiagnosticReport`
- `DiagnosticDevice`
- `LinkSpeed`
- `Evidence`
- `Verdict`
- `Confidence`

This crate should stay platform-neutral.

### `linkmetry-platform-linux`
Linux adapter for hardware inspection.

Initial implementation reads `/sys/bus/usb/devices` and extracts:

- vendor/product IDs
- manufacturer/product/serial strings when exposed
- bus/device numbers
- sysfs path
- topology-ish device path
- USB version
- negotiated speed
- USB device class

### `linkmetry-cli`
Internal developer probe. This should remain useful even after Tauri exists because it gives us fast JSON output for fixtures, tests, and platform comparison.

## Data separation

Every result should separate:

1. detected facts
2. measured performance
3. inferred verdicts
4. confidence
5. raw evidence

This is the core trust model of the product.

## Next architecture steps

- Add fixture-based tests for Linux sysfs parsing
- Add richer block-device/storage correlation
- Add safe read-only benchmark module
- Add Tauri shell only after the CLI model feels solid

## Current Linux storage correlation

The Linux adapter now reads `/sys/class/block`, filters real disks, maps USB-backed disks to their parent USB device id, and surfaces model/vendor/size/mountpoints plus USB link speed when available.

## Current benchmark prototype

`linkmetry-bench` provides a safe read-only file benchmark. On Linux it uses `posix_fadvise` hints to reduce page-cache distortion between iterations. This is still a prototype and does not perform write tests or raw block-device reads.

## Current combined diagnosis

`diagnose-storage` maps a benchmark target file back to the mounted storage device, carries through USB parent/link-speed evidence, runs the read-only benchmark, and emits a benchmark-aware verdict.

## UI-shaped card model

`DeviceCard` is the first UI-facing normalized shape. It condenses a storage device into title, subtitle, status tone, badges, primary verdict, and display facts so the future Tauri frontend does not have to understand raw sysfs details.

## Test fixtures

Linux sysfs fixture coverage now validates USB device parsing and storage-to-USB correlation using a Samsung T7-style fixture.
## 2026-04-26 Product Principle: Normal-Person First

Brad emphasized that Linkmetry must be friendly to regular people, not just tech nerds.

Implementation implication:
- Lead with plain-English summary and recommended next action.
- Hide raw USB/sysfs/topology details behind “technical evidence” or lower-priority sections.
- Avoid making users understand mount paths, device IDs, USB class codes, or Linux internals.
- Advanced details are still useful, but they should support the answer — not be the answer.

