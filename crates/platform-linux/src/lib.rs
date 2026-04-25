use anyhow::{Context, Result};
use linkmetry_core::{
    classify_usb_device, parse_usb_speed, verdicts_for_device, DiagnosticDevice, DiagnosticReport,
    Evidence, Platform,
};
use std::{fs, path::Path};

const USB_SYSFS_ROOT: &str = "/sys/bus/usb/devices";

pub fn inspect_usb_devices() -> Result<DiagnosticReport> {
    inspect_usb_devices_from(Path::new(USB_SYSFS_ROOT))
}

pub fn inspect_usb_devices_from(root: &Path) -> Result<DiagnosticReport> {
    let entries = fs::read_dir(root)
        .with_context(|| format!("failed to read USB sysfs root: {}", root.display()))?;

    let mut devices = Vec::new();

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if !path.is_dir() || !path.join("idVendor").exists() || !path.join("idProduct").exists() {
            continue;
        }

        devices.push(read_usb_device(&path)?);
    }

    devices.sort_by(|a, b| a.id.cmp(&b.id));

    Ok(DiagnosticReport {
        platform: Platform::Linux,
        devices,
    })
}

fn read_usb_device(path: &Path) -> Result<DiagnosticDevice> {
    let id = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string();

    let vendor_id = read_trimmed(path.join("idVendor"));
    let product_id = read_trimmed(path.join("idProduct"));
    let manufacturer = read_trimmed(path.join("manufacturer"));
    let product = read_trimmed(path.join("product"));
    let serial = read_trimmed(path.join("serial"));
    let bus_number: Option<u16> =
        read_trimmed(path.join("busnum")).and_then(|value| value.parse().ok());
    let device_number: Option<u16> =
        read_trimmed(path.join("devnum")).and_then(|value| value.parse().ok());
    let bus_number_evidence = bus_number.map(|n| n.to_string());
    let device_number_evidence = device_number.map(|n| n.to_string());
    let usb_version = read_trimmed(path.join("version"));
    let device_class = read_trimmed(path.join("bDeviceClass"));
    let raw_speed = read_trimmed(path.join("speed"));
    let negotiated_speed = raw_speed.as_deref().map(parse_usb_speed);
    let interface_classes = read_interface_classes(path);

    let kind = classify_usb_device(device_class.as_deref(), &interface_classes);
    let topology_path = id.clone();

    let mut evidence = Vec::new();
    push_evidence(&mut evidence, "sysfs", "idVendor", vendor_id.as_deref());
    push_evidence(&mut evidence, "sysfs", "idProduct", product_id.as_deref());
    push_evidence(
        &mut evidence,
        "sysfs",
        "manufacturer",
        manufacturer.as_deref(),
    );
    push_evidence(&mut evidence, "sysfs", "product", product.as_deref());
    push_evidence(&mut evidence, "sysfs", "serial", serial.as_deref());
    push_evidence(
        &mut evidence,
        "sysfs",
        "busnum",
        bus_number_evidence.as_deref(),
    );
    push_evidence(
        &mut evidence,
        "sysfs",
        "devnum",
        device_number_evidence.as_deref(),
    );
    push_evidence(&mut evidence, "sysfs", "version", usb_version.as_deref());
    push_evidence(
        &mut evidence,
        "sysfs",
        "bDeviceClass",
        device_class.as_deref(),
    );
    push_evidence(&mut evidence, "sysfs", "speed", raw_speed.as_deref());

    let mut device = DiagnosticDevice {
        id,
        kind,
        vendor_id,
        product_id,
        manufacturer,
        product,
        serial,
        bus_number,
        device_number,
        sysfs_path: Some(path.display().to_string()),
        topology_path: Some(topology_path),
        negotiated_speed,
        usb_version,
        device_class,
        interface_classes,
        evidence,
        verdicts: Vec::new(),
    };

    device.verdicts = verdicts_for_device(&device);
    Ok(device)
}

fn read_trimmed(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn push_evidence(evidence: &mut Vec<Evidence>, source: &str, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        evidence.push(Evidence {
            source: source.to_string(),
            key: key.to_string(),
            value: value.to_string(),
        });
    }
}

fn read_interface_classes(path: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };

    let mut classes = entries
        .flatten()
        .map(|entry| entry.path().join("bInterfaceClass"))
        .filter_map(read_trimmed)
        .collect::<Vec<_>>();

    classes.sort();
    classes.dedup();
    classes
}
