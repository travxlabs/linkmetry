use anyhow::{Context, Result};
use linkmetry_core::{BenchmarkResult, BenchmarkRun};
use std::{
    fs::File,
    io::Read,
    os::fd::AsRawFd,
    path::Path,
    time::{Duration, Instant},
};

const BUFFER_SIZE: usize = 8 * 1024 * 1024;

pub fn benchmark_file_read(path: impl AsRef<Path>, iterations: u32) -> Result<BenchmarkResult> {
    let path = path.as_ref();
    let metadata = path
        .metadata()
        .with_context(|| format!("failed to stat benchmark path: {}", path.display()))?;

    if !metadata.is_file() {
        anyhow::bail!("benchmark path must be a regular file for this safe read-only benchmark");
    }

    let iterations = iterations.max(1);
    let mut runs = Vec::new();

    for _ in 0..iterations {
        runs.push(read_once(path)?);
    }

    let average_mib_per_second =
        runs.iter().map(|run| run.mib_per_second).sum::<f64>() / runs.len() as f64;
    let best_mib_per_second = runs
        .iter()
        .map(|run| run.mib_per_second)
        .fold(0.0, f64::max);

    Ok(BenchmarkResult {
        kind: "read-file".to_string(),
        target: path.display().to_string(),
        bytes: metadata.len(),
        iterations,
        runs,
        average_mib_per_second,
        best_mib_per_second,
        caveats: vec![
            "Read-only file benchmark; results may be affected by OS page cache.".to_string(),
            "This does not test write speed and does not modify the target drive.".to_string(),
        ],
    })
}

fn read_once(path: &Path) -> Result<BenchmarkRun> {
    let mut file = File::open(path)
        .with_context(|| format!("failed to open benchmark path: {}", path.display()))?;
    advise_file_access(&file);
    let mut buffer = vec![0_u8; BUFFER_SIZE];
    let started = Instant::now();
    let mut bytes_read = 0_u64;

    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        bytes_read += count as u64;
    }

    let elapsed = started.elapsed();
    advise_drop_file_cache(&file);
    Ok(run_from_elapsed(bytes_read, elapsed))
}

fn run_from_elapsed(bytes_read: u64, elapsed: Duration) -> BenchmarkRun {
    let seconds = elapsed.as_secs_f64().max(0.000_001);
    let mib = bytes_read as f64 / 1024.0 / 1024.0;

    BenchmarkRun {
        bytes_read,
        elapsed_seconds: seconds,
        mib_per_second: mib / seconds,
    }
}

#[cfg(target_os = "linux")]
fn advise_file_access(file: &File) {
    unsafe {
        libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED);
        libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_SEQUENTIAL);
    }
}

#[cfg(not(target_os = "linux"))]
fn advise_file_access(_file: &File) {}

#[cfg(target_os = "linux")]
fn advise_drop_file_cache(file: &File) {
    unsafe {
        libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED);
    }
}

#[cfg(not(target_os = "linux"))]
fn advise_drop_file_cache(_file: &File) {}
