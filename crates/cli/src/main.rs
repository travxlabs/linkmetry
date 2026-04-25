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

            if pretty {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", serde_json::to_string(&report)?);
            }
        }
        "help" | "--help" | "-h" => print_help(),
        other => bail!("unknown command: {other}"),
    }

    Ok(())
}

fn print_help() {
    eprintln!("Linkmetry CLI prototype");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  linkmetry-cli inspect [--pretty]");
}
