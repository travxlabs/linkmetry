use anyhow::{Context, Result};
use linkmetry_core::{
    classify_usb_device, parse_usb_speed, verdicts_for_device, verdicts_for_storage,
    DiagnosticDevice, DiagnosticReport, Evidence, Platform, StorageDevice, StorageReport,
};
use std::{collections::HashMap, fs, path::Path};

const USB_SYSFS_ROOT: &str = "/sys/bus/usb/devices";
const BLOCK_SYSFS_ROOT: &str = "/sys/class/block";

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

pub fn inspect_storage_devices() -> Result<StorageReport> {
    inspect_storage_devices_from(Path::new(BLOCK_SYSFS_ROOT))
}

pub fn inspect_storage_devices_from(root: &Path) -> Result<StorageReport> {
    let mounts = read_mountpoints();
    inspect_storage_devices_from_with_mounts(root, &mounts)
}

pub fn inspect_storage_devices_from_with_mounts(
    root: &Path,
    mounts: &HashMap<String, Vec<String>>,
) -> Result<StorageReport> {
    let entries = fs::read_dir(root)
        .with_context(|| format!("failed to read block sysfs root: {}", root.display()))?;

    let mut devices = Vec::new();

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if !path.is_dir() || path.join("partition").exists() || !path.join("device").exists() {
            continue;
        }

        if name.starts_with("loop") || name.starts_with("ram") {
            continue;
        }

        devices.push(read_storage_device(&name, &path, &mounts)?);
    }

    devices.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(StorageReport {
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
    for interface_class in &interface_classes {
        push_evidence(
            &mut evidence,
            "sysfs",
            "bInterfaceClass",
            Some(interface_class),
        );
    }
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

fn read_storage_device(
    name: &str,
    path: &Path,
    mounts: &HashMap<String, Vec<String>>,
) -> Result<StorageDevice> {
    let real_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let model = read_trimmed(path.join("device/model"));
    let vendor = read_trimmed(path.join("device/vendor"));
    let serial = read_trimmed(path.join("device/serial"));
    let size_bytes = read_trimmed(path.join("size"))
        .and_then(|value| value.parse::<u64>().ok())
        .map(|sectors| sectors * 512);
    let removable = read_trimmed(path.join("removable")).and_then(|value| parse_boolish(&value));
    let rotational =
        read_trimmed(path.join("queue/rotational")).and_then(|value| parse_boolish(&value));
    let transport = if real_path.to_string_lossy().contains("/usb") {
        Some("usb".to_string())
    } else if name.starts_with("nvme") {
        Some("nvme".to_string())
    } else {
        None
    };
    let usb_device_id = extract_usb_device_id(&real_path);
    let usb_root = usb_device_id.as_ref().map(|id| usb_sysfs_root().join(id));
    let usb_link_speed = usb_root
        .as_ref()
        .and_then(|path| read_trimmed(path.join("speed")))
        .as_deref()
        .map(parse_usb_speed);
    let usb_product = usb_root
        .as_ref()
        .and_then(|path| read_trimmed(path.join("product")));
    let usb_speed_evidence = usb_link_speed.as_ref().map(|speed| speed.raw.clone());
    let mountpoints = mountpoints_for_device(name, mounts);

    let mut evidence = Vec::new();
    push_evidence(
        &mut evidence,
        "sysfs",
        "sysfs_path",
        Some(&real_path.display().to_string()),
    );
    push_evidence(&mut evidence, "sysfs", "model", model.as_deref());
    push_evidence(&mut evidence, "sysfs", "vendor", vendor.as_deref());
    push_evidence(&mut evidence, "sysfs", "serial", serial.as_deref());
    push_evidence(&mut evidence, "sysfs", "transport", transport.as_deref());
    push_evidence(
        &mut evidence,
        "sysfs",
        "usb_device_id",
        usb_device_id.as_deref(),
    );

    push_evidence(
        &mut evidence,
        "sysfs",
        "usb_speed",
        usb_speed_evidence.as_deref(),
    );
    push_evidence(
        &mut evidence,
        "sysfs",
        "usb_product",
        usb_product.as_deref(),
    );

    let mut device = StorageDevice {
        name: name.to_string(),
        dev_path: format!("/dev/{name}"),
        model,
        vendor,
        serial,
        size_bytes,
        removable,
        rotational,
        transport,
        mountpoints,
        sysfs_path: Some(real_path.display().to_string()),
        usb_device_id,
        usb_link_speed,
        usb_product,
        evidence,
        verdicts: Vec::new(),
    };

    device.verdicts = verdicts_for_storage(&device);
    Ok(device)
}

fn usb_sysfs_root() -> std::path::PathBuf {
    std::env::var_os("LINKMETRY_USB_SYSFS_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(USB_SYSFS_ROOT))
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

fn parse_boolish(value: &str) -> Option<bool> {
    match value.trim() {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    }
}

fn extract_usb_device_id(path: &Path) -> Option<String> {
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .filter(|part| {
            part.contains("-")
                && !part.contains(":")
                && part.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .last()
        .map(ToString::to_string)
}

fn read_mountpoints() -> HashMap<String, Vec<String>> {
    let mounts_path = std::env::var_os("LINKMETRY_PROC_MOUNTS")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/proc/mounts"));
    let Ok(contents) = fs::read_to_string(&mounts_path) else {
        return HashMap::new();
    };

    let mut mounts: HashMap<String, Vec<String>> = HashMap::new();
    for line in contents.lines() {
        let mut fields = line.split_whitespace();
        let Some(device) = fields.next() else {
            continue;
        };
        let Some(mountpoint) = fields.next() else {
            continue;
        };

        if let Some(name) = device.strip_prefix("/dev/") {
            mounts
                .entry(name.to_string())
                .or_default()
                .push(unescape_mountpoint(mountpoint));
        }
    }

    mounts
}

fn mountpoints_for_device(name: &str, mounts: &HashMap<String, Vec<String>>) -> Vec<String> {
    let mut found = Vec::new();

    for (device_name, device_mounts) in mounts {
        if device_name == name || device_name.starts_with(name) {
            found.extend(device_mounts.clone());
        }
    }

    found.sort();
    found.dedup();
    found
}

fn unescape_mountpoint(value: &str) -> String {
    value.replace("\\040", " ")
}
