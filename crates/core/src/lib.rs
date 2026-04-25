use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub kind: String,
    pub target: String,
    pub bytes: u64,
    pub iterations: u32,
    pub runs: Vec<BenchmarkRun>,
    pub average_mib_per_second: f64,
    pub best_mib_per_second: f64,
    pub caveats: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkRun {
    pub bytes_read: u64,
    pub elapsed_seconds: f64,
    pub mib_per_second: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub platform: Platform,
    pub devices: Vec<DiagnosticDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageReport {
    pub platform: Platform,
    pub devices: Vec<StorageDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Linux,
    MacOS,
    Windows,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticDevice {
    pub id: String,
    pub kind: DeviceKind,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub bus_number: Option<u16>,
    pub device_number: Option<u16>,
    pub sysfs_path: Option<String>,
    pub topology_path: Option<String>,
    pub negotiated_speed: Option<LinkSpeed>,
    pub usb_version: Option<String>,
    pub device_class: Option<String>,
    pub interface_classes: Vec<String>,
    pub evidence: Vec<Evidence>,
    pub verdicts: Vec<Verdict>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageDevice {
    pub name: String,
    pub dev_path: String,
    pub model: Option<String>,
    pub vendor: Option<String>,
    pub serial: Option<String>,
    pub size_bytes: Option<u64>,
    pub removable: Option<bool>,
    pub rotational: Option<bool>,
    pub transport: Option<String>,
    pub mountpoints: Vec<String>,
    pub sysfs_path: Option<String>,
    pub usb_device_id: Option<String>,
    pub usb_link_speed: Option<LinkSpeed>,
    pub usb_product: Option<String>,
    pub evidence: Vec<Evidence>,
    pub verdicts: Vec<Verdict>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceKind {
    UsbDevice,
    Storage,
    Hub,
    HumanInterface,
    Network,
    Audio,
    Video,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkSpeed {
    pub raw: String,
    pub mbps: Option<f64>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub source: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verdict {
    pub title: String,
    pub message: String,
    pub confidence: Confidence,
    pub evidence_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

pub fn classify_usb_device(class_code: Option<&str>, interface_classes: &[String]) -> DeviceKind {
    let normalized_device_class = class_code.map(str::to_ascii_lowercase);

    // Class 00 means class is declared per-interface, so inspect interfaces first.
    let classes: Vec<String> = if matches!(normalized_device_class.as_deref(), Some("00") | None) {
        interface_classes
            .iter()
            .map(|value| value.to_ascii_lowercase())
            .collect()
    } else {
        normalized_device_class.into_iter().collect()
    };

    if classes.iter().any(|class| class == "09") {
        DeviceKind::Hub
    } else if classes.iter().any(|class| class == "08") {
        DeviceKind::Storage
    } else if classes.iter().any(|class| class == "03") {
        DeviceKind::HumanInterface
    } else if classes.iter().any(|class| class == "02" || class == "0a") {
        DeviceKind::Network
    } else if classes.iter().any(|class| class == "01") {
        DeviceKind::Audio
    } else if classes.iter().any(|class| class == "0e") {
        DeviceKind::Video
    } else {
        DeviceKind::UsbDevice
    }
}

pub fn parse_usb_speed(raw: &str) -> LinkSpeed {
    let trimmed = raw.trim().to_string();
    let mbps = trimmed.parse::<f64>().ok();
    let label = match mbps {
        Some(speed) if speed <= 1.5 => "USB Low Speed (1.5 Mbps)".to_string(),
        Some(speed) if speed <= 12.0 => "USB Full Speed (12 Mbps)".to_string(),
        Some(speed) if speed <= 480.0 => "USB 2.0 High Speed (480 Mbps)".to_string(),
        Some(speed) if speed <= 5_000.0 => "USB 3.x SuperSpeed (5 Gbps)".to_string(),
        Some(speed) if speed <= 10_000.0 => "USB 3.x SuperSpeed+ (10 Gbps)".to_string(),
        Some(speed) if speed <= 20_000.0 => "USB 3.2 / USB4-class (20 Gbps)".to_string(),
        Some(speed) if speed <= 40_000.0 => "USB4 / Thunderbolt-class (40 Gbps)".to_string(),
        Some(speed) => format!("Unknown high-speed link ({speed} Mbps)"),
        None => format!("Unknown link speed ({trimmed})"),
    };

    LinkSpeed {
        raw: trimmed,
        mbps,
        label,
    }
}

pub fn verdicts_for_device(device: &DiagnosticDevice) -> Vec<Verdict> {
    let mut verdicts = Vec::new();

    if let Some(speed) = &device.negotiated_speed {
        if let Some(mbps) = speed.mbps {
            if mbps <= 480.0 {
                match device.kind {
                    DeviceKind::Storage => verdicts.push(Verdict {
                        title: "Storage device is on a USB 2.0-class path".to_string(),
                        message: "This looks like a storage device and it is negotiating at USB 2.0 speed or lower. For an SSD or modern enclosure, the cable, hub, or port path is probably the bottleneck.".to_string(),
                        confidence: Confidence::High,
                        evidence_keys: vec!["speed".to_string(), "bInterfaceClass".to_string()],
                    }),
                    DeviceKind::Hub => verdicts.push(Verdict {
                        title: "Hub is limited to USB 2.0-class speed".to_string(),
                        message: "This hub is negotiating at USB 2.0 speed or lower. Any storage device downstream of it will be capped by this path.".to_string(),
                        confidence: Confidence::High,
                        evidence_keys: vec!["speed".to_string(), "bDeviceClass".to_string()],
                    }),
                    _ => verdicts.push(Verdict {
                        title: "Low-bandwidth USB device".to_string(),
                        message: "This device is connected at USB 2.0 speed or lower. That is normal for many keyboards, mice, lighting controllers, audio devices, and other low-bandwidth peripherals.".to_string(),
                        confidence: Confidence::Medium,
                        evidence_keys: vec!["speed".to_string()],
                    }),
                }
            } else {
                verdicts.push(Verdict {
                    title: "High-speed USB connection detected".to_string(),
                    message: format!(
                        "The OS reports {}. Benchmarking is still needed before judging real-world performance.",
                        speed.label
                    ),
                    confidence: Confidence::Medium,
                    evidence_keys: vec!["speed".to_string()],
                });
            }
        }
    } else {
        verdicts.push(Verdict {
            title: "Connection speed unavailable".to_string(),
            message: "The OS did not expose a negotiated speed for this device through the current adapter. A benchmark or deeper platform-specific probe may be needed.".to_string(),
            confidence: Confidence::Low,
            evidence_keys: vec![],
        });
    }

    verdicts
}

pub fn verdicts_for_storage(device: &StorageDevice) -> Vec<Verdict> {
    let mut verdicts = Vec::new();

    if device.transport.as_deref() == Some("usb") {
        verdicts.push(Verdict {
            title: "External USB storage detected".to_string(),
            message: match &device.usb_link_speed {
                Some(speed) => format!("This storage device is attached through USB and the OS reports {}. Benchmarking comes next to verify real-world throughput.", speed.label),
                None => "This storage device is attached through USB. Linkmetry can correlate it with the USB connection path before benchmarking.".to_string(),
            },
            confidence: if device.usb_device_id.is_some() {
                Confidence::High
            } else {
                Confidence::Medium
            },
            evidence_keys: vec!["sysfs_path".to_string(), "usb_device_id".to_string(), "usb_speed".to_string()],
        });
    } else {
        verdicts.push(Verdict {
            title: "Non-USB storage device".to_string(),
            message: "This storage device does not appear to be attached through USB, so cable/path diagnosis is probably not relevant.".to_string(),
            confidence: Confidence::Medium,
            evidence_keys: vec!["sysfs_path".to_string()],
        });
    }

    verdicts
}
