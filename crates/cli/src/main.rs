use anyhow::{bail, Context, Result};
use linkmetry_core::{
    verdicts_for_storage_benchmark, BenchmarkResult, DeviceCard, Platform, StorageDevice, Verdict,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
struct StorageDiagnosisReport {
    target: String,
    storage: StorageDevice,
    card: DeviceCard,
    benchmark: BenchmarkResult,
    verdicts: Vec<Verdict>,
}

#[derive(Debug, Serialize)]
struct StorageCardsReport {
    platform: Platform,
    devices: Vec<StorageDevice>,
    cards: Vec<DeviceCard>,
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    let Some(command) = args.first().cloned() else {
        print_help();
        return Ok(());
    };
    args.remove(0);

    match command.as_str() {
        "inspect" => {
            let pretty = take_flag(&mut args, "--pretty") || take_flag(&mut args, "-p");
            let report = linkmetry_platform_linux::inspect_usb_devices()?;
            print_json(&report, pretty)?;
        }
        "storage" => {
            let pretty = take_flag(&mut args, "--pretty") || take_flag(&mut args, "-p");
            let report = linkmetry_platform_linux::inspect_storage_devices()?;
            print_json(&report, pretty)?;
        }
        "storage-cards" => {
            let pretty = take_flag(&mut args, "--pretty") || take_flag(&mut args, "-p");
            let report = storage_cards()?;
            print_json(&report, pretty)?;
        }
        "bench-read" => {
            let pretty = take_flag(&mut args, "--pretty") || take_flag(&mut args, "-p");
            let iterations = take_option(&mut args, "--iterations")
                .transpose()?
                .unwrap_or(3);
            let Some(path) = args.first() else {
                bail!("bench-read requires a file path");
            };
            let result = linkmetry_bench::benchmark_file_read(path, iterations)?;
            print_json(&result, pretty)?;
        }
        "diagnose-storage" => {
            let pretty = take_flag(&mut args, "--pretty") || take_flag(&mut args, "-p");
            let iterations = take_option(&mut args, "--iterations")
                .transpose()?
                .unwrap_or(3);
            let Some(path) = args.first() else {
                bail!("diagnose-storage requires a file path on the target drive");
            };
            let report = diagnose_storage(path, iterations)?;
            print_json(&report, pretty)?;
        }
        "help" | "--help" | "-h" => print_help(),
        other => bail!("unknown command: {other}"),
    }

    Ok(())
}

fn storage_cards() -> Result<StorageCardsReport> {
    let report = linkmetry_platform_linux::inspect_storage_devices()?;
    let cards = report.devices.iter().map(DeviceCard::from).collect();

    Ok(StorageCardsReport {
        platform: report.platform,
        devices: report.devices,
        cards,
    })
}

fn diagnose_storage(path: impl AsRef<Path>, iterations: u32) -> Result<StorageDiagnosisReport> {
    let path = path.as_ref();
    let canonical_path = path
        .canonicalize()
        .with_context(|| format!("failed to canonicalize path: {}", path.display()))?;
    let storage_report = linkmetry_platform_linux::inspect_storage_devices()?;
    let storage = find_storage_for_path(&canonical_path, storage_report.devices)
        .with_context(|| format!("could not map path to a storage device: {}", path.display()))?;
    let benchmark = linkmetry_bench::benchmark_file_read(&canonical_path, iterations)?;
    let verdicts = verdicts_for_storage_benchmark(&storage, &benchmark);

    let mut card = DeviceCard::from(&storage);
    card.primary_verdict = verdicts.first().cloned();

    Ok(StorageDiagnosisReport {
        target: canonical_path.display().to_string(),
        storage,
        card,
        benchmark,
        verdicts,
    })
}

fn find_storage_for_path(path: &Path, devices: Vec<StorageDevice>) -> Option<StorageDevice> {
    let mut candidates = devices
        .into_iter()
        .filter_map(|device| {
            let best_len = device
                .mountpoints
                .iter()
                .filter_map(|mountpoint| {
                    let mount_path = PathBuf::from(mountpoint);
                    path.starts_with(&mount_path).then_some(mountpoint.len())
                })
                .max()?;
            Some((best_len, device))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().map(|(_, device)| device).next()
}

fn print_json<T: serde::Serialize>(value: &T, pretty: bool) -> Result<()> {
    if pretty {
        println!("{}", serde_json::to_string_pretty(value)?);
    } else {
        println!("{}", serde_json::to_string(value)?);
    }

    Ok(())
}

fn take_flag(args: &mut Vec<String>, flag: &str) -> bool {
    if let Some(index) = args.iter().position(|arg| arg == flag) {
        args.remove(index);
        true
    } else {
        false
    }
}

fn take_option<T>(args: &mut Vec<String>, flag: &str) -> Option<Result<T>>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    let index = args.iter().position(|arg| arg == flag)?;
    args.remove(index);
    let Some(value) = args.get(index).cloned() else {
        return Some(Err(anyhow::anyhow!("{flag} requires a value")));
    };
    args.remove(index);
    Some(
        value
            .parse::<T>()
            .with_context(|| format!("invalid value for {flag}: {value}")),
    )
}

fn print_help() {
    eprintln!("Linkmetry CLI prototype");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  linkmetry-cli inspect [--pretty]");
    eprintln!("  linkmetry-cli storage [--pretty]");
    eprintln!("  linkmetry-cli bench-read [--iterations N] [--pretty] <file-path>");
    eprintln!("  linkmetry-cli diagnose-storage [--iterations N] [--pretty] <file-path>");
}
