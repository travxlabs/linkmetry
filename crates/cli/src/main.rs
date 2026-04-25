use anyhow::{bail, Result};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        print_help();
        return Ok(());
    };

    match command.as_str() {
        "inspect" => {
            let pretty = args.any(|arg| arg == "--pretty" || arg == "-p");
            let report = linkmetry_platform_linux::inspect_usb_devices()?;
            print_json(&report, pretty)?;
        }
        "storage" => {
            let pretty = args.any(|arg| arg == "--pretty" || arg == "-p");
            let report = linkmetry_platform_linux::inspect_storage_devices()?;
            print_json(&report, pretty)?;
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

fn print_help() {
    eprintln!("Linkmetry CLI prototype");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  linkmetry-cli inspect [--pretty]");
    eprintln!("  linkmetry-cli storage [--pretty]");
}
