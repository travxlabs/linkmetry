import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Confidence = "high" | "medium" | "low";
type StatusTone = "good" | "warning" | "info" | "unknown";

type Verdict = {
  title: string;
  message: string;
  confidence: Confidence;
  evidence_keys: string[];
};

type Fact = { label: string; value: string };

type DeviceCard = {
  title: string;
  subtitle?: string;
  status: StatusTone;
  badges: string[];
  primary_verdict?: Verdict;
  facts: Fact[];
};

type Evidence = { source: string; key: string; value: string };
type LinkSpeed = { raw: string; mbps?: number; label: string };

type BenchmarkRun = {
  bytes_read: number;
  elapsed_seconds: number;
  mib_per_second: number;
};

type BenchmarkResult = {
  kind: string;
  target: string;
  bytes: number;
  iterations: number;
  runs: BenchmarkRun[];
  average_mib_per_second: number;
  best_mib_per_second: number;
  caveats: string[];
};

type StorageDiagnosisReport = {
  generated_at: string;
  target: string;
  storage: StorageDevice;
  card: DeviceCard;
  benchmark: BenchmarkResult;
  verdicts: Verdict[];
};

type DiagnosticDevice = {
  id: string;
  kind: string;
  vendor_id?: string;
  product_id?: string;
  manufacturer?: string;
  product?: string;
  serial?: string;
  bus_number?: number;
  device_number?: number;
  sysfs_path?: string;
  topology_path?: string;
  negotiated_speed?: LinkSpeed;
  usb_version?: string;
  device_class?: string;
  interface_classes: string[];
  evidence: Evidence[];
  verdicts: Verdict[];
};

type StorageDevice = {
  name: string;
  dev_path: string;
  model?: string;
  vendor?: string;
  serial?: string;
  size_bytes?: number;
  removable?: boolean;
  rotational?: boolean;
  transport?: string;
  mountpoints: string[];
  sysfs_path?: string;
  usb_device_id?: string;
  usb_link_speed?: LinkSpeed;
  usb_product?: string;
  evidence: Evidence[];
  verdicts: Verdict[];
};

type LiveScanReport = {
  generated_at: string;
  platform: string;
  usb: {
    devices: DiagnosticDevice[];
  };
  storage: {
    devices: StorageDevice[];
    cards: DeviceCard[];
  };
};

type ScanState =
  | { status: "loading"; report?: LiveScanReport; error?: undefined }
  | { status: "ready"; report: LiveScanReport; error?: undefined }
  | { status: "error"; report?: LiveScanReport; error: string };

type DeviceAction = "explain" | "details" | "path" | "speed";
type SelectedDeviceAction = { deviceId: string; action: DeviceAction };

function App() {
  const [scan, setScan] = useState<ScanState>({ status: "loading" });
  const [selectedAction, setSelectedAction] = useState<SelectedDeviceAction | null>(null);

  async function runScan() {
    setScan((current) => ({ status: "loading", report: current.report }));
    try {
      const response = await fetch("/api/scan", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Scan failed with HTTP ${response.status}`);
      setScan({ status: "ready", report: payload });
    } catch (error) {
      setScan((current) => ({
        status: "error",
        report: current.report,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  useEffect(() => {
    runScan();
  }, []);

  const report = scan.report;
  const storageDevices = report?.storage.devices ?? [];
  const storageCards = report?.storage.cards ?? [];
  const usbDevices = report?.usb.devices ?? [];
  const usbStorageCount = storageDevices.filter((device) => device.transport === "usb").length;
  const highSpeedUsbCount = usbDevices.filter((device) => (device.negotiated_speed?.mbps ?? 0) > 480).length;

  const summary = report ? buildFriendlySummary(usbDevices, storageDevices) : null;
  const selectedDevice = selectedAction ? usbDevices.find((device) => device.id === selectedAction.deviceId) : undefined;
  const selectedStorage = selectedDevice ? storageDevices.find((device) => device.usb_device_id === selectedDevice.id) : undefined;

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Linkmetry USB control panel</p>
          <h1>Your USB ports and devices, explained.</h1>
          <p className="lede">
            A friendly control panel for what is plugged in, where it is connected, how fast it is negotiating, and what diagnostics are available.
          </p>
        </div>
        <button className="scanButton" onClick={runScan} disabled={scan.status === "loading"}>
          {scan.status === "loading" ? "Scanning…" : "Run scan"}
        </button>
      </section>

      <section className="card scanStatusCard">
        <div className="cardTopline">
          <span className={`statusDot ${scan.status === "error" ? "warning" : scan.status === "ready" ? "good" : "info"}`} />
          <span className="statusText">{scanStatusLabel(scan.status)}</span>
        </div>
        <div className="deviceHeader">
          <div>
            <h2>{summary?.headline ?? `${usbDevices.length} connected device${usbDevices.length === 1 ? "" : "s"} found`}</h2>
            <p className="muted">
              {summary?.subline ?? `${highSpeedUsbCount} high-speed USB · ${usbStorageCount} USB-backed storage`} · Platform: {report?.platform ?? "linux"}
              {report?.generated_at ? ` · Refreshed ${new Date(report.generated_at).toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="badges">
            <span>Safe scan</span>
            <span>Read-only</span>
            <span>Details available</span>
          </div>
        </div>
        {scan.status === "error" ? <p className="errorText">{scan.error}</p> : null}
      </section>

      {scan.status === "loading" && !report ? <LoadingCard /> : null}
      {scan.status !== "loading" && report && usbDevices.length === 0 ? <EmptyCard /> : null}
      {summary ? <FriendlySummary summary={summary} /> : null}
      {report ? <ConnectionMap devices={usbDevices} storageDevices={storageDevices} selectedAction={selectedAction} onAction={setSelectedAction} /> : null}
      {report ? <DevicesToCheck cards={storageCards} storageDevices={storageDevices} usbDevices={usbDevices} /> : null}
      {report ? <UsbInventory devices={usbDevices} storageDevices={storageDevices} /> : null}
    </main>
  );
}

function LoadingCard() {
  return (
    <section className="card">
      <p className="eyebrow">Scanning</p>
      <h2>Asking the Rust inspector what is connected…</h2>
      <p className="muted">This runs the Linkmetry CLI locally on trav-dev and returns normalized USB + storage data.</p>
    </section>
  );
}

function EmptyCard() {
  return (
    <section className="card">
      <p className="eyebrow">No USB devices</p>
      <h2>No inspectable USB devices were returned.</h2>
      <p className="muted">Confirm Linux exposes USB data under /sys/bus/usb/devices.</p>
    </section>
  );
}

type FriendlySummaryData = {
  headline: string;
  subline: string;
  cards: Array<{ title: string; value: string; note: string; tone: StatusTone }>;
};

function FriendlySummary({ summary }: { summary: FriendlySummaryData }) {
  return (
    <section className="card friendlySummary">
      <p className="eyebrow">Plain-English summary</p>
      <h2>What Linkmetry found</h2>
      <div className="summaryGrid">
        {summary.cards.map((card) => (
          <div className={`summaryTile ${card.tone}`} key={card.title}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConnectionMap({ devices, storageDevices, selectedAction, onAction }: { devices: DiagnosticDevice[]; storageDevices: StorageDevice[]; selectedAction: SelectedDeviceAction | null; onAction: (action: SelectedDeviceAction | null) => void }) {
  const map = useMemo(() => buildConnectionMap(devices), [devices]);
  const storageByUsbId = useMemo(() => new Map(storageDevices.filter((device) => device.usb_device_id).map((device) => [device.usb_device_id, device])), [storageDevices]);
  const externalStorageIds = new Set(storageDevices.map((device) => device.usb_device_id).filter(Boolean));

  return (
    <section className="card connectionMapCard">
      <p className="eyebrow">Control panel</p>
      <h2>Ports, paths, and connected devices</h2>
      <p className="muted inventoryIntro">This is the main view: each visible USB path, what is attached to it, negotiated speed, and what Linkmetry can help with next.</p>
      <div className="portGrid">
        {map.map((port) => (
          <article className="portCard" key={port.root.id}>
            <div className="portHeader">
              <div>
                <span>{port.root.id}</span>
                <strong>{deviceName(port.root)}</strong>
              </div>
              <em>{port.root.negotiated_speed?.label ?? "speed unknown"}</em>
            </div>
            <div className="portDevices">
              {port.children.length > 0 ? port.children.map((device) => (
                <div className={`portDevice ${externalStorageIds.has(device.id) ? "primaryDevice" : ""}`} key={device.id}>
                  <span>{kindLabel(device.kind)}</span>
                  <strong>{deviceName(device)}</strong>
                  <p>{device.negotiated_speed?.label ?? "Speed unavailable"} · path {device.topology_path ?? device.id}</p>
                  <DeviceActions device={device} storageDevice={storageByUsbId.get(device.id)} selectedAction={selectedAction} onAction={onAction} />
                  {selectedAction?.deviceId === device.id ? (
                    <DeviceActionPanel action={selectedAction.action} device={device} storageDevice={storageByUsbId.get(device.id)} usbDevices={devices} onClose={() => onAction(null)} compact />
                  ) : null}
                </div>
              )) : <p className="muted">No downstream devices visible on this path.</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DeviceActions({ device, storageDevice, selectedAction, onAction }: { device: DiagnosticDevice; storageDevice?: StorageDevice; selectedAction: SelectedDeviceAction | null; onAction: (action: SelectedDeviceAction | null) => void }) {
  const actions = availableActions(storageDevice);
  return (
    <div className="deviceActions">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={selectedAction?.deviceId === device.id && selectedAction.action === action.action ? "active" : ""}
          disabled={!action.enabled}
          title={action.reason ?? action.label}
          onClick={() => action.enabled && handleDeviceAction(action.action, device.id, selectedAction, onAction)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function handleDeviceAction(action: DeviceAction, deviceId: string, selectedAction: SelectedDeviceAction | null, onAction: (action: SelectedDeviceAction | null) => void) {
  if (selectedAction?.deviceId === deviceId && selectedAction.action === action) {
    onAction(null);
    return;
  }
  onAction({ deviceId, action });
  if (action === "speed") {
    window.setTimeout(() => document.getElementById("external-drive-diagnostics")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
}

function availableActions(storageDevice?: StorageDevice): Array<{ label: string; action: DeviceAction; enabled: boolean; reason?: string }> {
  return [
    { label: "Explain", action: "explain", enabled: true },
    { label: "Details", action: "details", enabled: true },
    { label: "Check path", action: "path", enabled: true },
    { label: "Speed test", action: "speed", enabled: Boolean(storageDevice?.transport === "usb"), reason: storageDevice ? undefined : "Speed test is currently available for external drives only." },
  ];
}

function DeviceActionPanel({ action, device, storageDevice, usbDevices, onClose, compact = false }: { action: DeviceAction; device: DiagnosticDevice; storageDevice?: StorageDevice; usbDevices: DiagnosticDevice[]; onClose: () => void; compact?: boolean }) {
  const path = buildConnectionPath(device.id, usbDevices);
  const explanation = explainDevice(device, storageDevice, path);

  return (
    <section className={compact ? "actionPanel inlineActionPanel" : "card actionPanel"}>
      <div className="actionPanelHeader">
        <div>
          <p className="eyebrow">{actionPanelTitle(action)}</p>
          <h2>{deviceName(device)}</h2>
          <p className="muted">{kindLabel(device.kind)} · {device.negotiated_speed?.label ?? "speed unknown"}</p>
        </div>
        <button type="button" className="plainButton" onClick={onClose}>Close</button>
      </div>

      {action === "explain" ? <p className="actionExplanation">{explanation}</p> : null}

      {action === "details" ? (
        <div className="actionGrid">
          <FriendlyFact label="Device type" value={kindLabel(device.kind)} />
          <FriendlyFact label="Connection speed" value={device.negotiated_speed?.label ?? "Unknown"} />
          <FriendlyFact label="Manufacturer" value={device.manufacturer ?? "Unknown"} />
          <FriendlyFact label="Product" value={device.product ?? "Unknown"} />
          <FriendlyFact label="USB path" value={device.topology_path ?? device.id} />
          <FriendlyFact label="Device ID" value={`${device.vendor_id ?? "????"}:${device.product_id ?? "????"}`} />
        </div>
      ) : null}

      {action === "path" ? (
        <div className="pathPanel">
          <p className="actionExplanation">{path.length > 1 ? `${deviceName(device)} is connected through ${path.length - 1} visible upstream USB step${path.length - 1 === 1 ? "" : "s"}.` : `${deviceName(device)} appears directly on this USB path.`}</p>
          <ol className="pathSteps">
            {path.map((step, index) => (
              <li key={step.id}>
                <span className="pathIndex">{index + 1}</span>
                <div><strong>{deviceName(step)}</strong><p>{kindLabel(step.kind)} · {step.negotiated_speed?.label ?? "speed unavailable"} · {step.topology_path ?? step.id}</p></div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {action === "speed" ? (
        <p className="actionExplanation">Speed test is available in External drive diagnostics below. Use Auto-pick test file to run it without choosing a path manually.</p>
      ) : null}
    </section>
  );
}

function actionPanelTitle(action: DeviceAction) {
  return { explain: "Explain this device", details: "Device details", path: "Connection path", speed: "Speed test" }[action];
}

function explainDevice(device: DiagnosticDevice, storageDevice: StorageDevice | undefined, path: DiagnosticDevice[]) {
  if (storageDevice) {
    return `${deviceName(device)} looks like an external storage device connected over ${device.negotiated_speed?.label ?? "an unknown USB speed"}. Linkmetry can inspect its connection path and run a safe read-only speed test.`;
  }
  if (device.kind === "hub") return `${deviceName(device)} is a USB hub or controller path. It helps explain where other devices are connected, but it usually is not something you directly test.`;
  if ((device.negotiated_speed?.mbps ?? 0) <= 12) return `${deviceName(device)} is a low-bandwidth USB device. That is normal for keyboards, receivers, lighting controllers, and similar accessories.`;
  return `${deviceName(device)} is connected over ${device.negotiated_speed?.label ?? "USB"}. Linkmetry can show its details and where it sits in the USB connection path.${path.length > 1 ? ` It has ${path.length - 1} visible upstream step${path.length - 1 === 1 ? "" : "s"}.` : ""}`;
}

function DevicesToCheck({ cards, storageDevices, usbDevices }: { cards: DeviceCard[]; storageDevices: StorageDevice[]; usbDevices: DiagnosticDevice[] }) {
  const externalIndexes = storageDevices
    .map((device, index) => ({ device, index }))
    .filter(({ device }) => device.transport === "usb");

  return (
    <section className="deviceCheckSection" id="external-drive-diagnostics">
      <div className="sectionIntro">
        <p className="eyebrow">Secondary tool</p>
        <h2>External drive diagnostics</h2>
        <p className="muted">Extra tools for storage devices, like speed testing. This is a secondary diagnostic workflow under the main connection map.</p>
      </div>
      {externalIndexes.length > 0 ? (
        externalIndexes.map(({ device, index }) => (
          <DeviceSummary key={device.dev_path} card={cards[index]} device={device} usbDevices={usbDevices} />
        ))
      ) : (
        <section className="card"><h2>No external drives found</h2><p className="muted">Plug in an external USB drive to test speed and cable/path health.</p></section>
      )}
    </section>
  );
}

function UsbInventory({ devices, storageDevices }: { devices: DiagnosticDevice[]; storageDevices: StorageDevice[] }) {
  const externalStorageIds = new Set(storageDevices.map((device) => device.usb_device_id).filter(Boolean));
  const groups = useMemo(() => groupUsbDevices(devices.filter((device) => !externalStorageIds.has(device.id))), [devices, storageDevices]);

  return (
    <details className="card technicalDetails">
      <summary>
        <div>
          <p className="eyebrow">Technical details</p>
          <h2>Raw USB/device list</h2>
          <p className="muted">For troubleshooting: accessories, hubs, controllers, and lower-level USB details.</p>
        </div>
        <span className="detailsPill">Show details</span>
      </summary>

      <InventoryGroup title="Everyday accessories" description="Keyboards, receivers, lighting controllers, and other low-bandwidth devices. These are usually fine at lower speeds." devices={groups.peripherals} empty="No everyday accessories detected." />
      <InventoryGroup title="Other notable USB devices" description="Audio/video/network devices and fast USB devices that are not already shown above." devices={groups.important} empty="No other standout devices detected." />
      <InventoryGroup title="Hubs & controllers" description="USB hubs, root buses, and controller paths. Useful for troubleshooting, but not the first thing most people need." devices={groups.infrastructure} empty="No hub/controller devices detected." />
    </details>
  );
}

function InventoryGroup({
  title,
  description,
  devices,
  empty,
  collapsed = false,
}: {
  title: string;
  description: string;
  devices: DiagnosticDevice[];
  empty: string;
  collapsed?: boolean;
}) {
  const content = (
    <>
      <p className="muted groupDescription">{description}</p>
      {devices.length > 0 ? (
        <div className="usbGrid">
          {devices.map((device) => <UsbDeviceTile key={device.id} device={device} />)}
        </div>
      ) : (
        <p className="muted emptyGroup">{empty}</p>
      )}
    </>
  );

  if (collapsed) {
    return (
      <details className="inventoryGroup" open={devices.length <= 4}>
        <summary>{title} <span>{devices.length}</span></summary>
        {content}
      </details>
    );
  }

  return (
    <div className="inventoryGroup">
      <h3>{title} <span>{devices.length}</span></h3>
      {content}
    </div>
  );
}

function buildFriendlySummary(usbDevices: DiagnosticDevice[], storageDevices: StorageDevice[]): FriendlySummaryData {
  const externalDrives = storageDevices.filter((device) => device.transport === "usb");
  const fastDevices = usbDevices.filter((device) => (device.negotiated_speed?.mbps ?? 0) > 480);
  const slowStorage = externalDrives.filter((device) => (device.usb_link_speed?.mbps ?? Number.POSITIVE_INFINITY) <= 480);
  const fastestDrive = externalDrives
    .filter((device) => device.usb_link_speed?.mbps)
    .sort((a, b) => (b.usb_link_speed?.mbps ?? 0) - (a.usb_link_speed?.mbps ?? 0))[0];

  return {
    headline: `${usbDevices.length} connected USB device${usbDevices.length === 1 ? "" : "s"} found`,
    subline: `${fastDevices.length} fast connection${fastDevices.length === 1 ? "" : "s"} · ${externalDrives.length} external drive${externalDrives.length === 1 ? "" : "s"}`,
    cards: [
      {
        title: "Connection map",
        value: `${visiblePortCount(usbDevices)} visible USB path${visiblePortCount(usbDevices) === 1 ? "" : "s"}`,
        note: "See what is connected where, including hubs and downstream devices.",
        tone: "info",
      },
      {
        title: "Possible issue",
        value: slowStorage.length > 0 ? `${slowStorage.length} slow storage path${slowStorage.length === 1 ? "" : "s"}` : "No obvious slow storage path",
        note: slowStorage.length > 0 ? "At least one external drive appears to be on a USB 2.0-class path." : "No external storage path is obviously capped at USB 2.0 speed.",
        tone: slowStorage.length > 0 ? "warning" : "good",
      },
      {
        title: "Control panel",
        value: `${usbDevices.length} devices detected`,
        note: "Linkmetry is becoming one place to inspect, understand, and troubleshoot USB ports and devices.",
        tone: "info",
      },
    ],
  };
}

function buildConnectionMap(devices: DiagnosticDevice[]) {
  const roots = devices
    .filter((device) => device.id.startsWith("usb") || /^\d+-\d+$/.test(device.id))
    .sort((a, b) => sortSpeed(b) - sortSpeed(a) || a.id.localeCompare(b.id));

  return roots.map((root) => ({
    root,
    children: devices
      .filter((device) => device.id !== root.id && isDownstreamOf(device.id, root.id))
      .filter((device) => !device.id.startsWith("usb"))
      .sort((a, b) => sortSpeed(b) - sortSpeed(a) || a.id.localeCompare(b.id)),
  })).filter((port) => port.children.length > 0 || port.root.id.startsWith("usb"));
}

function isDownstreamOf(deviceId: string, rootId: string) {
  if (rootId.startsWith("usb")) {
    const bus = rootId.replace("usb", "");
    return deviceId.startsWith(`${bus}-`);
  }
  return deviceId.startsWith(`${rootId}.`);
}

function visiblePortCount(devices: DiagnosticDevice[]) {
  return buildConnectionMap(devices).length;
}

function groupUsbDevices(devices: DiagnosticDevice[]) {
  const sorted = [...devices].sort((a, b) => sortSpeed(b) - sortSpeed(a) || a.id.localeCompare(b.id));
  const important: DiagnosticDevice[] = [];
  const peripherals: DiagnosticDevice[] = [];
  const infrastructure: DiagnosticDevice[] = [];

  for (const device of sorted) {
    if (isInfrastructureDevice(device)) infrastructure.push(device);
    else if (isImportantDevice(device)) important.push(device);
    else peripherals.push(device);
  }

  return { important, peripherals, infrastructure };
}

function isInfrastructureDevice(device: DiagnosticDevice) {
  const product = (device.product ?? "").toLowerCase();
  return device.kind === "hub" || product.includes("host controller") || device.id.startsWith("usb");
}

function isImportantDevice(device: DiagnosticDevice) {
  const highSpeed = (device.negotiated_speed?.mbps ?? 0) > 480;
  return ["storage", "audio", "video", "network"].includes(device.kind) || highSpeed;
}

function UsbDeviceTile({ device }: { device: DiagnosticDevice }) {
  const verdict = device.verdicts[0];
  const tone = device.negotiated_speed?.mbps && device.negotiated_speed.mbps > 480 ? "good" : device.negotiated_speed ? "info" : "unknown";
  const title = device.product ?? device.manufacturer ?? device.id;

  return (
    <article className="usbTile">
      <div className="cardTopline compact">
        <span className={`statusDot ${tone}`} />
        <span>{kindLabel(device.kind)}</span>
      </div>
      <h3>{title}</h3>
      <p className="muted">{device.manufacturer && device.product ? device.manufacturer : device.id}</p>
      <div className="miniFacts">
        <span>{device.negotiated_speed?.label ?? "Speed unavailable"}</span>
        <span>{device.topology_path ?? device.id}</span>
        <span>{device.vendor_id ?? "????"}:{device.product_id ?? "????"}</span>
      </div>
      {verdict ? <p className="tileVerdict">{verdict.title}</p> : null}
    </article>
  );
}

function DeviceSummary({ card, device, usbDevices }: { card: DeviceCard; device?: StorageDevice; usbDevices: DiagnosticDevice[] }) {
  const verdict = card.primary_verdict;
  const connectionPath = device?.usb_device_id ? buildConnectionPath(device.usb_device_id, usbDevices) : [];

  return (
    <section className="card deviceCard">
      <div className="cardTopline">
        <span className={`statusDot ${card.status}`} />
        <span className="statusText">{statusLabel(card.status)}</span>
      </div>
      <div className="deviceHeader">
        <div>
          <h2>{card.title}</h2>
          <p>{card.subtitle}</p>
        </div>
        <div className="badges">
          {card.badges.map((badge) => <span key={badge}>{badge}</span>)}
        </div>
      </div>

      {verdict ? (
        <div className="verdictBox">
          <strong>{verdict.title}</strong>
          <p>{verdict.message}</p>
        </div>
      ) : null}

      <div className="friendlyFacts">
        <FriendlyFact label="Connected as" value={device?.usb_link_speed?.label ?? "Speed unknown"} />
        <FriendlyFact label="Available at" value={benchmarkableMountpoints(device ?? ({} as StorageDevice))[0] ?? device?.dev_path ?? "Unknown"} />
        <FriendlyFact label="Likely status" value={verdict?.title ?? "Needs a speed test"} />
      </div>

      {device ? <BenchmarkControl device={device} /> : null}
      {device ? <ConnectionPathPanel device={device} path={connectionPath} /> : null}
      {device ? <EvidencePanel device={device} /> : null}
    </section>
  );
}

function FriendlyFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConnectionPathPanel({ device, path }: { device: StorageDevice; path: DiagnosticDevice[] }) {
  if (!device.usb_device_id) return null;

  const bottleneck = findPathBottleneck(path);

  return (
    <div className="connectionPathBox">
      <p className="eyebrow">Connection path</p>
      <h3>{path.length > 0 ? describePath(path) : `USB path ${device.usb_device_id}`}</h3>
      <p className="muted">
        {path.length > 0
          ? "This is the current upstream USB chain Linux exposes for this storage device."
          : "Linux exposed a USB device id, but Linkmetry could not reconstruct the full upstream chain yet."}
      </p>
      {bottleneck ? (
        <div className="pathInsight warningInsight">
          <strong>Potential path bottleneck</strong>
          <span>{bottleneck}</span>
        </div>
      ) : (
        <div className="pathInsight">
          <strong>Connection path looks okay</strong>
          <span>Nothing in the visible route looks slower than the device itself.</span>
        </div>
      )}
      {path.length > 0 ? (
        <ol className="pathSteps">
          {path.map((step, index) => (
            <li key={step.id}>
              <span className="pathIndex">{index + 1}</span>
              <div>
                <strong>{deviceName(step)}</strong>
                <p>{kindLabel(step.kind)} · {step.negotiated_speed?.label ?? "speed unavailable"} · {step.topology_path ?? step.id}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function BenchmarkControl({ device }: { device: StorageDevice }) {
  const benchmarkMountpoints = benchmarkableMountpoints(device);
  const isUsbStorage = device.transport === "usb";
  const suggestedTarget = benchmarkMountpoints[0] ? `${benchmarkMountpoints[0]}/path/to/large-file` : "/path/to/large-file";
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<StorageDiagnosisReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBenchmark() {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      setStatus("error");
      setError("Click Auto-pick test file, or paste the full path to a large file on this drive.");
      return;
    }
    if (normalizedTarget.endsWith("/")) {
      setStatus("error");
      setError("That is a folder. Click Auto-pick test file, or paste a full file path inside that folder.");
      return;
    }

    await fetchBenchmark(`/api/benchmark?iterations=3&target=${encodeURIComponent(normalizedTarget)}`);
  }

  async function runAutoBenchmark() {
    const mount = benchmarkMountpoints[0];
    if (!mount) {
      setStatus("error");
      setError("No benchmarkable USB mount was found for this drive.");
      return;
    }
    await fetchBenchmark(`/api/benchmark/auto?iterations=3&mount=${encodeURIComponent(mount)}`);
  }

  async function fetchBenchmark(url: string) {
    setStatus("running");
    setError(null);
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Benchmark failed with HTTP ${response.status}`);
      setTarget(payload.target ?? target);
      setResult(payload);
      setStatus("done");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  }

  return (
    <div className="benchmarkBox">
      <div>
        <p className="eyebrow">Speed test</p>
        <h3>Check how fast this drive can read</h3>
        <p className="muted">Safe read-only test. Click auto-pick and Linkmetry will choose a large readable file on this drive. It does not write to the drive.</p>
      </div>
      {isUsbStorage ? (
        <>
          <div className="benchmarkControls">
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={suggestedTarget}
            />
            <button className="scanButton small secondary" onClick={runAutoBenchmark} disabled={status === "running" || benchmarkMountpoints.length === 0}>
              Auto-pick test file
            </button>
            <button className="scanButton small" onClick={runBenchmark} disabled={status === "running"}>
              {status === "running" ? "Testing…" : "Run read test"}
            </button>
          </div>
          {benchmarkMountpoints.length > 0 ? (
            <div className="mountSuggestions">
              {benchmarkMountpoints.map((mountpoint) => (
                <button key={mountpoint} type="button" onClick={() => setTarget(`${mountpoint}/path/to/large-file`)}>{mountpoint}</button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted benchmarkDisabled">Read benchmark is hidden for internal/system storage in this prototype. Linkmetry is focusing on external USB storage first.</p>
      )}
      {error ? <p className="errorText">{error}</p> : null}
      {result ? <BenchmarkResultPanel result={result} /> : null}
    </div>
  );
}

function BenchmarkResultPanel({ result }: { result: StorageDiagnosisReport }) {
  const verdict = result.verdicts[0];
  const max = Math.max(...result.benchmark.runs.map((run) => run.mib_per_second), 1);

  return (
    <div className="benchmarkResult">
      {verdict ? (
        <div className="verdictBox compactVerdict">
          <strong>{verdict.title}</strong>
          <p>{verdict.message}</p>
        </div>
      ) : null}
      <div className="benchmarkStats">
        <div>
          <span>Average</span>
          <strong>{result.benchmark.average_mib_per_second.toFixed(0)} MiB/s</strong>
        </div>
        <div>
          <span>Best</span>
          <strong>{result.benchmark.best_mib_per_second.toFixed(0)} MiB/s</strong>
        </div>
        <div>
          <span>File</span>
          <strong>{formatBytes(result.benchmark.bytes)}</strong>
        </div>
      </div>
      <div className="runs compactRuns">
        {result.benchmark.runs.map((run, index) => (
          <div className="run" key={index}>
            <div className="runLabel">
              <span>Run {index + 1}</span>
              <strong>{run.mib_per_second.toFixed(0)} MiB/s</strong>
            </div>
            <div className="barTrack"><span style={{ width: `${(run.mib_per_second / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidencePanel({ device }: { device?: StorageDevice }) {
  const evidence = useMemo(() => device?.evidence ?? [], [device]);
  if (!device) return null;

  return (
    <section className="card evidenceCard">
      <p className="eyebrow">Technical evidence</p>
      <h2>Details behind the answer for {device.dev_path}</h2>
      <div className="evidenceList">
        <EvidenceItem label="Storage path" value={`${device.vendor ?? ""} ${device.model ?? device.dev_path}`.trim()} />
        <EvidenceItem label="USB device id" value={device.usb_device_id ?? "Unavailable"} />
        <EvidenceItem label="Negotiated link" value={device.usb_link_speed?.label ?? "Unavailable"} />
        <EvidenceItem label="Mounted at" value={device.mountpoints.join(", ") || "Not mounted"} />
        {evidence.slice(0, 8).map((item) => (
          <EvidenceItem key={`${item.source}:${item.key}:${item.value}`} label={`${item.source}:${item.key}`} value={item.value} />
        ))}
      </div>
    </section>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildConnectionPath(usbDeviceId: string, devices: DiagnosticDevice[]) {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const ids = parentChainIds(usbDeviceId);
  return ids.map((id) => byId.get(id)).filter((device): device is DiagnosticDevice => Boolean(device));
}

function parentChainIds(id: string) {
  const ids: string[] = [];
  const rootMatch = id.match(/^(\d+)-/);
  if (rootMatch) ids.push(`usb${rootMatch[1]}`);

  let current = id;
  const parts = current.split(".");
  while (parts.length > 1) {
    ids.push(parts.join("."));
    parts.pop();
  }
  ids.push(parts[0]);
  if (!ids.includes(id)) ids.push(id);
  return Array.from(new Set(ids));
}

function describePath(path: DiagnosticDevice[]) {
  const endpoint = path[path.length - 1];
  const upstreamHub = [...path].reverse().find((device) => device.kind === "hub" && device.id !== endpoint.id);
  if (upstreamHub) return `${deviceName(endpoint)} downstream of ${deviceName(upstreamHub)}`;
  return `${deviceName(endpoint)} direct USB path`;
}

function findPathBottleneck(path: DiagnosticDevice[]) {
  const endpoint = path[path.length - 1];
  const endpointSpeed = endpoint?.negotiated_speed?.mbps;
  if (!endpointSpeed) return null;

  const slower = path.slice(0, -1).find((device) => {
    const speed = device.negotiated_speed?.mbps;
    return speed && speed < endpointSpeed;
  });

  if (!slower) return null;
  return `${deviceName(slower)} reports ${slower.negotiated_speed?.label}, below the endpoint speed of ${endpoint.negotiated_speed?.label}.`;
}

function deviceName(device: DiagnosticDevice) {
  return device.product ?? device.manufacturer ?? device.id;
}

function benchmarkableMountpoints(device: StorageDevice) {
  const blocked = new Set(["/", "/boot", "/boot/efi", "/etc/hostname", "/etc/hosts", "/etc/resolv.conf"]);
  return device.mountpoints.filter((mountpoint) => {
    if (blocked.has(mountpoint)) return false;
    if (mountpoint.startsWith("/app/")) return false;
    return mountpoint.startsWith("/mnt/") || mountpoint.startsWith("/home/");
  });
}

function sortSpeed(device: DiagnosticDevice) {
  return device.negotiated_speed?.mbps ?? 0;
}

function kindLabel(kind: string) {
  return kind.replaceAll("-", " ");
}

function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function scanStatusLabel(status: ScanState["status"]) {
  return { loading: "Scanning live data", ready: "Live data loaded", error: "Live scan error" }[status];
}

function statusLabel(status: StatusTone) {
  return { good: "Healthy path", warning: "Needs attention", info: "Informational", unknown: "Unknown" }[status];
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
