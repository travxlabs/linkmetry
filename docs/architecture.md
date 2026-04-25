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
