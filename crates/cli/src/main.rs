use anyhow::{bail, Context, Result};

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
        "help" | "--help" | "-h" => print_help(),
        other => bail!("unknown command: {other}"),
    }

    Ok(())
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
}
