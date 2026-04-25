use std::{collections::HashMap, path::PathBuf};

#[test]
fn parses_usb_storage_device_from_fixture() {
    let root = fixture_path("usb-devices");
    let report = linkmetry_platform_linux::inspect_usb_devices_from(&root).unwrap();

    assert_eq!(report.devices.len(), 1);
    let device = &report.devices[0];
    assert_eq!(device.id, "2-7.2");
    assert_eq!(device.product.as_deref(), Some("PSSD T7 Shield"));
    assert_eq!(device.negotiated_speed.as_ref().unwrap().mbps, Some(5000.0));
    assert_eq!(format!("{:?}", device.kind), "Storage");
}

#[test]
fn correlates_usb_storage_with_parent_usb_device_from_fixture() {
    let block_root = fixture_path("block");
    let usb_root = fixture_path("usb-devices");
    std::env::set_var("LINKMETRY_USB_SYSFS_ROOT", usb_root);

    let mut mounts = HashMap::new();
    mounts.insert("sdb1".to_string(), vec!["/mnt/t7".to_string()]);

    let report =
        linkmetry_platform_linux::inspect_storage_devices_from_with_mounts(&block_root, &mounts)
            .unwrap();

    assert_eq!(report.devices.len(), 1);
    let device = &report.devices[0];
    assert_eq!(device.name, "sdb");
    assert_eq!(device.model.as_deref(), Some("PSSD T7 Shield"));
    assert_eq!(device.transport.as_deref(), Some("usb"));
    assert_eq!(device.usb_device_id.as_deref(), Some("2-7.2"));
    assert_eq!(device.usb_link_speed.as_ref().unwrap().mbps, Some(5000.0));
    assert_eq!(device.mountpoints, vec!["/mnt/t7".to_string()]);
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}
