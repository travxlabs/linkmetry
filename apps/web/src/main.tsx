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
type LinkSpeed = { raw: string; mbps?: number; label: string; generation?: string; is_usb3_or_better?: boolean };

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
  | { status: "idle"; report?: undefined; error?: undefined }
  | { status: "loading"; report?: LiveScanReport; error?: undefined }
  | { status: "ready"; report: LiveScanReport; error?: undefined }
  | { status: "error"; report?: LiveScanReport; error: string };

type DeviceAction = "explain" | "details" | "path" | "speed";
type SelectedDeviceAction = { deviceId: string; action: DeviceAction };
type PortLabels = Record<string, string>;
type PortLabelingSession = { active: boolean; baselinePathIds: string[] };
type Page = "overview" | "drives";

function App() {
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [selectedAction, setSelectedAction] = useState<SelectedDeviceAction | null>(null);
  const [portLabels, setPortLabels] = useState<PortLabels>(() => loadPortLabels());
  const [labelingSession, setLabelingSession] = useState<PortLabelingSession>({ active: false, baselinePathIds: [] });
  const [page, setPage] = useState<Page>("overview");

  function savePortLabel(pathId: string, label: string) {
    setPortLabels((current) => {
      const next = { ...current };
      const trimmed = label.trim();
      if (trimmed) next[pathId] = trimmed;
      else delete next[pathId];
      window.localStorage.setItem("linkmetry.portLabels", JSON.stringify(next));
      return next;
    });
  }

  function startPortLabeling() {
    setLabelingSession({ active: true, baselinePathIds: usbDevices.filter(isPrimaryUserDevice).map(devicePathId) });
  }

  function stopPortLabeling() {
    setLabelingSession({ active: false, baselinePathIds: [] });
  }

  function exportPortLabels() {
    const payload = JSON.stringify(portLabels, null, 2);
    navigator.clipboard?.writeText(payload).catch(() => undefined);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "linkmetry-port-labels.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importPortLabels(labels: PortLabels) {
    setPortLabels(labels);
    window.localStorage.setItem("linkmetry.portLabels", JSON.stringify(labels));
  }

  async function runScan() {
    setScan((current) => ({ status: "loading", report: current.report }));
    const minimumScanTime = wait(2000);
    try {
      const response = await fetch("/api/scan", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Scan failed with HTTP ${response.status}`);
      await minimumScanTime;
      setScan({ status: "ready", report: payload });
    } catch (error) {
      await minimumScanTime;
      setScan((current) => ({
        status: "error",
        report: current.report,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }


  const report = scan.report;
  const storageDevices = report?.storage.devices ?? [];
  const storageCards = report?.storage.cards ?? [];
  const usbDevices = report?.usb.devices ?? [];
  const usbStorageCount = storageDevices.filter((device) => device.transport === "usb").length;
  const humanDeviceCount = usbDevices.filter(isPrimaryUserDevice).length;

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
            <h2>{summary?.headline ?? "Ready to scan your USB devices"}</h2>
            <p className="muted">
              {summary?.subline ?? "Run a safe read-only scan when you are ready. Nothing is benchmarked or changed automatically."}{report?.generated_at ? ` · Refreshed ${new Date(report.generated_at).toLocaleTimeString()}` : ""}
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

      {scan.status === "idle" ? <PreScanCard onScan={runScan} /> : null}
      {scan.status === "loading" && !report ? <LoadingCard /> : null}
      {scan.status !== "loading" && report && usbDevices.length === 0 ? <EmptyCard /> : null}
      {report ? <PageTabs page={page} onPage={setPage} driveCount={storageDevices.filter((device) => device.transport === "usb").length} /> : null}
      {page === "overview" ? (
        <>
          {summary ? <FriendlySummary summary={summary} /> : null}
          {report ? <ConnectionMap devices={usbDevices} storageDevices={storageDevices} portLabels={portLabels} onLabel={savePortLabel} selectedAction={selectedAction} onAction={setSelectedAction} /> : null}
          {report ? <PortFinderGuide devices={usbDevices} storageDevices={storageDevices} portLabels={portLabels} labelingSession={labelingSession} onStartLabeling={startPortLabeling} onStopLabeling={stopPortLabeling} onExportLabels={exportPortLabels} onImportLabels={importPortLabels} onLabel={savePortLabel} onRescan={runScan} scanning={scan.status === "loading"} /> : null}
          {report ? <UsbInventory devices={usbDevices} storageDevices={storageDevices} /> : null}
        </>
      ) : null}
      {page === "drives" && report ? <DriveDiagnosticsPage cards={storageCards} storageDevices={storageDevices} usbDevices={usbDevices} /> : null}
    </main>
  );
}

function PageTabs({ page, onPage, driveCount }: { page: Page; onPage: (page: Page) => void; driveCount: number }) {
  return (
    <nav className="pageTabs" aria-label="Linkmetry sections">
      <button type="button" className={page === "overview" ? "active" : ""} onClick={() => onPage("overview")}>Overview</button>
      <button type="button" className={page === "drives" ? "active" : ""} onClick={() => onPage("drives")}>Drive diagnostics{driveCount ? ` (${driveCount})` : ""}</button>
    </nav>
  );
}

function PreScanCard({ onScan }: { onScan: () => void }) {
  return (
    <section className="card preScanCard">
      <p className="eyebrow">Start here</p>
      <h2>Run a scan when you are ready.</h2>
      <p className="muted">Linkmetry will look at connected USB devices and external drives, then explain the results in normal language. Advanced technical details stay hidden unless you open them.</p>
      <button className="scanButton" onClick={onScan}>Run scan</button>
    </section>
  );
}

function LoadingCard() {
  return (
    <section className="card scanEffectCard">
      <div className="scanOrb" aria-hidden="true"><span /></div>
      <p className="eyebrow">Scanning</p>
      <h2>Checking connected devices…</h2>
      <p className="muted">Looking for recognizable devices, external drives, and port changes. This takes about two seconds.</p>
      <div className="scanProgress" aria-hidden="true"><span /></div>
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

function PortFinderGuide({ devices, storageDevices, portLabels, labelingSession, onStartLabeling, onStopLabeling, onExportLabels, onImportLabels, onLabel, onRescan, scanning }: { devices: DiagnosticDevice[]; storageDevices: StorageDevice[]; portLabels: PortLabels; labelingSession: PortLabelingSession; onStartLabeling: () => void; onStopLabeling: () => void; onExportLabels: () => void; onImportLabels: (labels: PortLabels) => void; onLabel: (pathId: string, label: string) => void; onRescan: () => void; scanning: boolean }) {
  const storageByUsbId = new Map(storageDevices.filter((device) => device.usb_device_id).map((device) => [device.usb_device_id, device]));
  const candidates = devices
    .filter(isPrimaryUserDevice)
    .sort(deviceImportanceSort)
    .slice(0, 4);
  const changedCandidates = labelingSession.active
    ? candidates.filter((device) => !labelingSession.baselinePathIds.includes(devicePathId(device)))
    : [];
  const best = changedCandidates[0] ?? candidates.find((device) => storageByUsbId.has(device.id)) ?? candidates[0];
  const labelCount = Object.keys(portLabels).length;

  return (
    <section className="card portFinderCard">
      <div className="portFinderHeader">
        <div>
          <p className="eyebrow">Find the physical port</p>
          <h2>Map real ports by moving one device at a time.</h2>
          <p className="muted">Do not worry about the evidence path. To find a real position like “back, bottom row, 2 over,” use this guided move-and-rescan flow.</p>
        </div>
        <div className="portFinderActions">
          {labelingSession.active ? <button className="scanButton small secondary" onClick={onStopLabeling}>Stop labeling</button> : <button className="scanButton small secondary" onClick={onStartLabeling}>Start port labeling</button>}
          <button className="scanButton small secondary" onClick={onRescan} disabled={scanning}>{scanning ? "Scanning…" : "Rescan after moving device"}</button>
        </div>
      </div>
      <div className="portFinderSteps">
        <div><span>1</span><strong>Click Start labeling</strong><p>This saves the current state before you move anything.</p></div>
        <div><span>2</span><strong>Move one obvious device</strong><p>Move the T7 to the exact physical port you want to identify, like back bottom row, second from left.</p></div>
        <div><span>3</span><strong>Click Rescan</strong><p>Linkmetry highlights what changed. Name that physical spot in your own words.</p></div>
      </div>
      {labelingSession.active ? (
        <div className={changedCandidates.length > 0 ? "labelingStatus good" : "labelingStatus"}>
          <strong>{changedCandidates.length > 0 ? "New path candidate found" : "Labeling mode is active"}</strong>
          <p>{changedCandidates.length > 0 ? "This is the device you moved. Name the physical port you just plugged it into." : "Now move exactly one device to the physical port you want to identify, then click Rescan."}</p>
        </div>
      ) : null}
      {best ? (
        <div className={`portFinderExample ${changedCandidates.includes(best) ? "newPathCandidate" : ""}`}>
          <span>{changedCandidates.includes(best) ? "New path candidate" : "Current example"}</span>
          <strong>{deviceName(best)} → {friendlyPortName(best, portLabels)}</strong>
          <p>{changedCandidates.includes(best) ? "Name the physical port you just used — for example, back bottom row, 2 over." : "Use Start labeling, move this device to a physical port, then rescan. Linkmetry will highlight the moved device so you can name that port."}</p>
          <PortLabelEditor pathId={devicePathId(best)} portLabels={portLabels} onLabel={onLabel} />
        </div>
      ) : null}
      <PortLabelBackup labels={portLabels} labelCount={labelCount} onExport={onExportLabels} onImport={onImportLabels} />
    </section>
  );
}

function PortLabelBackup({ labelCount, onExport, onImport }: { labels: PortLabels; labelCount: number; onExport: () => void; onImport: (labels: PortLabels) => void }) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleImport(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PortLabels;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
      onImport(parsed);
      setStatus(`Imported ${Object.keys(parsed).length} label${Object.keys(parsed).length === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Import failed: ${error.message}` : "Import failed.");
    }
  }

  return (
    <div className="portLabelBackup">
      <div>
        <span>Browser-local labels</span>
        <strong>{labelCount} saved label{labelCount === 1 ? "" : "s"}</strong>
        <p>Prototype labels are saved in this browser. Export a backup before clearing cache or switching browsers.</p>
      </div>
      <div className="portLabelBackupActions">
        <button type="button" onClick={onExport} disabled={labelCount === 0}>Export labels</button>
        <label>
          Import labels
          <input type="file" accept="application/json,.json" onChange={(event) => handleImport(event.target.files?.[0])} />
        </label>
      </div>
      {status ? <p className="portLabelBackupStatus">{status}</p> : null}
    </div>
  );
}

function ConnectionMap({ devices, storageDevices, portLabels, onLabel, selectedAction, onAction }: { devices: DiagnosticDevice[]; storageDevices: StorageDevice[]; portLabels: PortLabels; onLabel: (pathId: string, label: string) => void; selectedAction: SelectedDeviceAction | null; onAction: (action: SelectedDeviceAction | null) => void }) {
  const map = useMemo(() => buildConnectionMap(devices), [devices]);
  const attachedDevices = useMemo(() => devices.filter((device) => !isPortOrPath(device)).sort(deviceImportanceSort), [devices]);
  const primaryDevices = attachedDevices.filter(isPrimaryUserDevice);
  const accessoryDevices = attachedDevices.filter((device) => !isPrimaryUserDevice(device));
  const storageByUsbId = useMemo(() => new Map(storageDevices.filter((device) => device.usb_device_id).map((device) => [device.usb_device_id, device])), [storageDevices]);
  const externalStorageIds = new Set(storageDevices.map((device) => device.usb_device_id).filter(Boolean));

  return (
    <section className="card connectionMapCard">
      <p className="eyebrow">Devices first</p>
      <h2>Actual devices connected right now</h2>
      <p className="muted inventoryIntro">Start here: these are the things you recognize — drives, keyboards, mice, audio interfaces, receivers, and accessories. Technical port/path IDs are shown only as supporting evidence.</p>

      <div className="deviceFirstLayout">
        <div>
          <h3>Devices</h3>
          <div className="connectedDeviceList">
            {primaryDevices.map((device) => (
              <div className={`portDevice ${externalStorageIds.has(device.id) ? "primaryDevice" : ""}`} key={device.id}>
                <span>{deviceRoleLabel(device, storageByUsbId.get(device.id))}</span>
                <strong>{deviceName(device)}</strong>
                <p>{deviceConnectionSummary(device, storageByUsbId.get(device.id), portLabels)}</p>
                <InlineDeviceVerdict device={device} storageDevice={storageByUsbId.get(device.id)} />
                <PortLabelEditor pathId={devicePathId(device)} portLabels={portLabels} onLabel={onLabel} />
                <details className="deviceMoreDetails">
                  <summary>Show more details</summary>
                  <PortSpeedEvidence device={device} storageDevice={storageByUsbId.get(device.id)} />
                  <details className="evidencePathDisclosure">
                    <summary>Show technical evidence path</summary>
                    <p>{devicePathId(device)}</p>
                  </details>
                </details>
                <DeviceActions device={device} storageDevice={storageByUsbId.get(device.id)} selectedAction={selectedAction} onAction={onAction} />
                {selectedAction?.deviceId === device.id ? (
                  <DeviceActionPanel action={selectedAction.action} device={device} storageDevice={storageByUsbId.get(device.id)} usbDevices={devices} onClose={() => onAction(null)} compact />
                ) : null}
              </div>
            ))}
          {accessoryDevices.length > 0 ? (
            <details className="accessoryDisclosure">
              <summary>
                <span>Advanced · internal/accessory endpoints</span>
                <strong>{accessoryDevices.length} hidden USB endpoint{accessoryDevices.length === 1 ? "" : "s"}</strong>
              </summary>
              <p className="muted">Shown for troubleshooting only. These may be RGB controllers, cooler controllers, receivers, or other low-level endpoints. They are not included in the main device count.</p>
              <div className="connectedDeviceList compactAccessoryList">
                {accessoryDevices.map((device) => (
                  <div className="portDevice" key={device.id}>
                    <span>{deviceRoleLabel(device, storageByUsbId.get(device.id))}</span>
                    <strong>{deviceName(device)}</strong>
                    <p><SpeedBadge speed={device.negotiated_speed} /> {deviceConnectionSummary(device, storageByUsbId.get(device.id), portLabels)}</p>
                    <PortSpeedEvidence device={device} storageDevice={storageByUsbId.get(device.id)} compact />
                    <details className="evidencePathDisclosure">
                      <summary>Show technical evidence path</summary>
                      <p>{devicePathId(device)}</p>
                    </details>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          </div>
        </div>
      </div>

      <details className="portDetailsDisclosure">
        <summary>
          <span>Advanced · technical ports & paths</span>
          <strong>Show raw USB buses, hubs, and topology IDs</strong>
        </summary>
        <p className="muted evidenceNote">Advanced troubleshooting view. These are Linux topology paths such as <strong>1-10</strong> or <strong>2-7.2</strong>. They help identify physical ports, but they are not human-friendly device names and are not included in the main count.</p>
        <div className="portGrid compactPorts">
          {map.map((port) => (
            <article className="portCard" key={port.root.id}>
              <div className="portHeader">
                <div>
                  <span>{port.root.id}</span>
                  <strong>{port.root.id.startsWith("usb") ? `USB bus ${port.root.id.replace("usb", "")}` : deviceName(port.root)}</strong>
                </div>
                <em>{port.root.negotiated_speed?.generation ?? port.root.negotiated_speed?.label ?? "speed unknown"}</em>
              </div>
              <p className="muted portCount">{summarizePort(port.children)}</p>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}

function SpeedBadge({ speed }: { speed?: LinkSpeed }) {
  const label = speed?.generation ?? speed?.label ?? "Unknown speed";
  const tone = speed?.is_usb3_or_better ? "usb3" : speed?.mbps && speed.mbps <= 480 ? "usb2" : "unknown";
  return <span className={`speedBadge ${tone}`}>{label}</span>;
}

function summarizePort(children: DiagnosticDevice[]) {
  const visible = children.filter((device) => !isPortOrPath(device));
  const highSpeed = visible.filter((device) => (device.negotiated_speed?.mbps ?? 0) > 480).length;
  const storage = visible.filter((device) => device.kind === "storage").length;
  const lowBandwidth = visible.filter((device) => (device.negotiated_speed?.mbps ?? 0) <= 12).length;
  const parts = [`${visible.length} connected device${visible.length === 1 ? "" : "s"}`];
  if (storage) parts.push(`${storage} drive${storage === 1 ? "" : "s"}`);
  if (highSpeed) parts.push(`${highSpeed} high-speed`);
  if (lowBandwidth && lowBandwidth === visible.length) parts.push("low-bandwidth path");
  return parts.join(" · ");
}

function deviceRoleLabel(device: DiagnosticDevice, storageDevice?: StorageDevice) {
  if (storageDevice?.transport === "usb") return "external drive";
  if (device.kind === "human-interface") return "input/accessory";
  if ((device.negotiated_speed?.mbps ?? 0) <= 12) return "low-bandwidth accessory";
  return kindLabel(device.kind);
}

function deviceConnectionSummary(device: DiagnosticDevice, storageDevice: StorageDevice | undefined, portLabels: PortLabels = {}) {
  const location = friendlyPortName(device, portLabels);
  if (storageDevice?.transport === "usb") {
    const mount = benchmarkableMountpoints(storageDevice)[0] ?? storageDevice.mountpoints[0];
    return `external storage on ${location}${mount ? ` · mounted at ${mount}` : ""}`;
  }
  if ((device.negotiated_speed?.mbps ?? 0) <= 12) return `normal for simple accessories · ${location}`;
  return `connected on ${location}`;
}

function friendlyPortName(device: DiagnosticDevice, portLabels: PortLabels) {
  const pathId = devicePathId(device);
  return portLabels[pathId] ? `${portLabels[pathId]} (${pathId})` : `path ${pathId}`;
}

function devicePathId(device: DiagnosticDevice) {
  return device.topology_path ?? device.id;
}

function PortLabelEditor({ pathId, portLabels, onLabel }: { pathId: string; portLabels: PortLabels; onLabel: (pathId: string, label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(portLabels[pathId] ?? "");

  useEffect(() => {
    setDraft(portLabels[pathId] ?? "");
  }, [pathId, portLabels]);

  if (!editing) {
    return (
      <div className="portLabelLine">
        <span>Port label</span>
        <strong>{portLabels[pathId] ?? "Unnamed port"}</strong>
        <button type="button" onClick={() => setEditing(true)}>{portLabels[pathId] ? "Rename" : "Name this port"}</button>
      </div>
    );
  }

  return (
    <div className="portLabelEditor">
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Example: Back bottom row, 2 over" autoFocus />
      <button type="button" onClick={() => { onLabel(pathId, draft); setEditing(false); }}>Save</button>
      <button type="button" className="plainButton" onClick={() => { setDraft(portLabels[pathId] ?? ""); setEditing(false); }}>Cancel</button>
    </div>
  );
}

function PortSpeedEvidence({ device, storageDevice, compact = false }: { device: DiagnosticDevice; storageDevice?: StorageDevice; compact?: boolean }) {
  const speed = device.negotiated_speed;
  const isFast = Boolean(speed?.is_usb3_or_better);
  const isUsb2 = Boolean(speed?.mbps && speed.mbps <= 480);
  const deviceLimited = isLikelyDeviceLimitedUsb2(device, storageDevice);
  const tone = isFast ? "good" : isUsb2 && !deviceLimited ? "warning" : "info";
  const title = isFast ? "Current link: USB 3-class" : isUsb2 ? "Current link: USB 2-class" : "Current link: unknown";
  const message = deviceLimited
    ? "This may be normal for this device. Use a known USB 3 drive to verify the physical port capability."
    : isFast
      ? "This path is currently proving USB 3-class speed with the connected device."
      : "This only proves the current device link, not the port’s maximum capability.";

  return (
    <div className={`portSpeedEvidence ${tone} ${compact ? "compact" : ""}`}>
      <span>Advanced · {title}</span>
      <strong>{speed?.label ?? "Speed unavailable"}</strong>
      <p>{message}</p>
    </div>
  );
}

function isLikelyDeviceLimitedUsb2(device: DiagnosticDevice, storageDevice?: StorageDevice) {
  if (storageDevice?.transport === "usb") return false;
  const label = `${device.manufacturer ?? ""} ${device.product ?? ""}`.toLowerCase();
  if (label.includes("scarlett") || label.includes("audio") || label.includes("keyboard") || label.includes("mouse") || label.includes("receiver")) return true;
  return ["audio", "human-interface"].includes(device.kind);
}

function InlineDeviceVerdict({ device, storageDevice }: { device: DiagnosticDevice; storageDevice?: StorageDevice }) {
  const verdict = deviceQuickVerdict(device, storageDevice);
  return (
    <div className={`inlineVerdict ${verdict.tone}`}>
      <span>{verdict.label}</span>
      <strong>{verdict.message}</strong>
    </div>
  );
}

function deviceQuickVerdict(device: DiagnosticDevice, storageDevice?: StorageDevice): { tone: StatusTone; label: string; message: string } {
  const speed = device.negotiated_speed?.mbps;
  if (storageDevice?.transport === "usb") {
    if (storageDevice.usb_link_speed?.is_usb3_or_better) {
      return { tone: "good", label: "Looks good", message: "External drive is on a USB 3-class path; run a read test for real throughput." };
    }
    if ((storageDevice.usb_link_speed?.mbps ?? Number.POSITIVE_INFINITY) <= 480) {
      return { tone: "warning", label: "Likely bottleneck", message: "External drive appears capped at USB 2.0-class speed." };
    }
    return { tone: "unknown", label: "Needs test", message: "Drive is detected, but Linkmetry needs more speed evidence." };
  }

  if (speed !== undefined && speed <= 12) {
    return { tone: "info", label: "Normal", message: "Low-bandwidth accessory; slow USB speed is expected here." };
  }

  if (speed !== undefined && speed <= 480 && ["audio", "human-interface", "usb-device"].includes(device.kind)) {
    return { tone: "info", label: "Probably normal", message: "This class of device usually does not need USB 3 speed." };
  }

  if (device.negotiated_speed?.is_usb3_or_better) {
    return { tone: "good", label: "High-speed", message: "USB 3-class link is available for this device." };
  }

  return { tone: "unknown", label: "Unknown", message: "Connection is visible, but speed evidence is limited." };
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
  const bottleneck = findPathBottleneck(path);

  return (
    <section className={compact ? "actionPanel inlineActionPanel" : "card actionPanel"}>
      <div className="actionPanelHeader">
        <div>
          <p className="eyebrow">{actionPanelTitle(action)}</p>
          <h2>{deviceName(device)}</h2>
          <p className="muted">{kindLabel(device.kind)} · {device.negotiated_speed?.generation ?? device.negotiated_speed?.label ?? "speed unknown"}</p>
        </div>
        <button type="button" className="plainButton" onClick={onClose}>Close</button>
      </div>

      {action === "explain" ? <p className="actionExplanation">{explanation}</p> : null}

      {action === "details" ? (
        <div className="actionGrid">
          <FriendlyFact label="Device type" value={kindLabel(device.kind)} />
          <FriendlyFact label="USB generation" value={device.negotiated_speed?.generation ?? "Unknown"} />
          <FriendlyFact label="Manufacturer" value={device.manufacturer ?? "Unknown"} />
          <FriendlyFact label="Product" value={device.product ?? "Unknown"} />
          <FriendlyFact label="USB path" value={device.topology_path ?? device.id} />
          <FriendlyFact label="Device ID" value={`${device.vendor_id ?? "????"}:${device.product_id ?? "????"}`} />
        </div>
      ) : null}

      {action === "path" ? (
        <div className="pathPanel">
          <p className="actionExplanation">{path.length > 1 ? `${deviceName(device)} is connected through ${path.length - 1} visible upstream USB step${path.length - 1 === 1 ? "" : "s"}.` : `${deviceName(device)} appears directly on this USB path.`}</p>
          {bottleneck ? (
            <div className="pathInsight warningInsight">
              <strong>Possible bottleneck</strong>
              <span>{bottleneck}</span>
            </div>
          ) : (
            <div className="pathInsight">
              <strong>No visible path bottleneck</strong>
              <span>Every visible upstream step is at least as fast as this device, based on what Linux exposes.</span>
            </div>
          )}
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
        storageDevice ? <BenchmarkControl device={storageDevice} /> : <p className="actionExplanation">Speed test is currently available for external USB storage only.</p>
      ) : null}
    </section>
  );
}

function actionPanelTitle(action: DeviceAction) {
  return { explain: "Explain this device", details: "Device details", path: "Connection path", speed: "Speed test" }[action];
}

function explainDevice(device: DiagnosticDevice, storageDevice: StorageDevice | undefined, path: DiagnosticDevice[]) {
  const speedLabel = device.negotiated_speed?.label ?? "an unknown USB speed";
  const bottleneck = findPathBottleneck(path);

  if (storageDevice) {
    const mount = benchmarkableMountpoints(storageDevice)[0] ?? storageDevice.mountpoints[0] ?? storageDevice.dev_path;
    if (bottleneck) {
      return `${deviceName(device)} is an external drive, but the visible USB path may be limiting it: ${bottleneck} It is available at ${mount}. Run the safe read test to compare real throughput with the negotiated link.`;
    }
    return `${deviceName(device)} is an external drive connected over ${speedLabel}. The visible path does not show an upstream bottleneck, so the next useful check is a safe read-only speed test from ${mount}.`;
  }

  if (device.kind === "hub") {
    return `${deviceName(device)} is part of the USB path, not usually the thing you test directly. It matters because anything downstream can only perform as well as this path allows.`;
  }

  if ((device.negotiated_speed?.mbps ?? 0) <= 12) {
    return `${deviceName(device)} is a low-bandwidth USB device. That is normal for keyboards, receivers, lighting controllers, and similar accessories, so this is not automatically a problem.`;
  }

  if (bottleneck) {
    return `${deviceName(device)} is connected over ${speedLabel}, but Linkmetry sees a slower upstream step: ${bottleneck}`;
  }

  return `${deviceName(device)} is connected over ${speedLabel}. Linkmetry does not see an obvious upstream bottleneck in the current Linux USB path.${path.length > 1 ? ` The visible path has ${path.length - 1} upstream step${path.length - 1 === 1 ? "" : "s"}.` : ""}`;
}

function DriveDiagnosticsPage({ cards, storageDevices, usbDevices }: { cards: DeviceCard[]; storageDevices: StorageDevice[]; usbDevices: DiagnosticDevice[] }) {
  const externalIndexes = storageDevices
    .map((device, index) => ({ device, index }))
    .filter(({ device }) => device.transport === "usb");

  return (
    <section className="deviceCheckSection driveDiagnosticsPage" id="external-drive-diagnostics">
      <div className="sectionIntro">
        <p className="eyebrow">Drive diagnostics</p>
        <h2>Test external drives separately.</h2>
        <p className="muted">This page is for deeper storage checks like safe read tests. The main overview stays focused on what is connected and where.</p>
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
          <p className="eyebrow">Advanced technical details</p>
          <h2>Raw USB entries</h2>
          <p className="muted">For debugging only: this includes hubs, controllers, topology nodes, and low-level endpoints that normal users do not think of as “devices.”</p>
        </div>
        <span className="detailsPill">Show advanced details</span>
      </summary>

      <InventoryGroup title="Raw accessory endpoints" description="Low-bandwidth USB endpoints exposed by the OS. Some are recognizable accessories; some may be internal controller pieces." devices={groups.peripherals} empty="No raw accessory endpoints detected." />
      <InventoryGroup title="Raw notable endpoints" description="Audio/video/network/high-speed endpoints from the raw USB scan that are not already part of the main simplified view." devices={groups.important} empty="No raw notable endpoints detected." />
      <InventoryGroup title="Raw hubs, buses, and controllers" description="USB hubs, root buses, and controller paths. Useful for port mapping and debugging; not counted as user-facing devices." devices={groups.infrastructure} empty="No hub/controller entries detected." />
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
  const humanDevices = usbDevices.filter(isPrimaryUserDevice);
  const fastDevices = humanDevices.filter((device) => (device.negotiated_speed?.mbps ?? 0) > 480);
  const slowStorage = externalDrives.filter((device) => (device.usb_link_speed?.mbps ?? Number.POSITIVE_INFINITY) <= 480);
  const fastestDrive = externalDrives
    .filter((device) => device.usb_link_speed?.mbps)
    .sort((a, b) => (b.usb_link_speed?.mbps ?? 0) - (a.usb_link_speed?.mbps ?? 0))[0];

  return {
    headline: `${humanDevices.length} recognizable USB device${humanDevices.length === 1 ? "" : "s"} found`,
    subline: `${fastDevices.length} fast recognizable connection${fastDevices.length === 1 ? "" : "s"} · ${externalDrives.length} external drive${externalDrives.length === 1 ? "" : "s"} · ${usbDevices.length} raw USB entries in technical details`,
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
        value: `${humanDevices.length} recognizable device${humanDevices.length === 1 ? "" : "s"}`,
        note: `${usbDevices.length} raw USB entries include internal hubs/controllers; those stay in technical details.`,
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

function isPrimaryUserDevice(device: DiagnosticDevice) {
  if (!isHumanFacingDevice(device)) return false;
  const label = `${device.manufacturer ?? ""} ${device.product ?? ""}`.toLowerCase();
  const internalHints = ["lighting", "aura", "h150i", "controller", "node core", "node pro"];
  if (internalHints.some((hint) => label.includes(hint))) return false;
  if (["storage", "audio", "video", "network"].includes(device.kind)) return true;
  const userHints = ["keyboard", "keychron", "mouse", "receiver", "scarlett", "audio", "webcam", "camera", "mic", "microphone"];
  return userHints.some((hint) => label.includes(hint));
}

function isHumanFacingDevice(device: DiagnosticDevice) {
  if (isPortOrPath(device)) return false;
  const product = (device.product ?? "").toLowerCase();
  if (!device.product && !device.manufacturer) return false;
  if (product.includes("host controller")) return false;
  return true;
}

function isPortOrPath(device: DiagnosticDevice) {
  return device.id.startsWith("usb") || device.kind === "hub";
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

function deviceImportanceSort(a: DiagnosticDevice, b: DiagnosticDevice) {
  return devicePriority(b) - devicePriority(a) || sortSpeed(b) - sortSpeed(a) || deviceName(a).localeCompare(deviceName(b));
}

function devicePriority(device: DiagnosticDevice) {
  if (device.kind === "storage") return 100;
  if (["audio", "video", "network"].includes(device.kind)) return 80;
  if ((device.negotiated_speed?.mbps ?? 0) > 480) return 70;
  if ((device.negotiated_speed?.mbps ?? 0) <= 12) return 20;
  return 40;
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
  return { idle: "Ready to scan", loading: "Scanning live data", ready: "Live data loaded", error: "Live scan error" }[status];
}

function statusLabel(status: StatusTone) {
  return { good: "Healthy path", warning: "Needs attention", info: "Informational", unknown: "Unknown" }[status];
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

function loadPortLabels(): PortLabels {
  try {
    return JSON.parse(window.localStorage.getItem("linkmetry.portLabels") ?? "{}") as PortLabels;
  } catch {
    return {};
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
