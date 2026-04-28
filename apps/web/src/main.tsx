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
type PortMetadata = Record<string, { usb3Verified?: boolean; verifiedWith?: string; verifiedAt?: string; lastSeenDevice?: string; lastSeenSpeed?: string; lastSeenAt?: string }>;
type PortLabelingSession = { active: boolean; baselinePathIds: string[] };
type Page = "overview" | "ports" | "drives";
type ScanHistoryEntry = { id: string; label: string; generated_at: string; report: LiveScanReport };
type ScanChange = { tone: StatusTone; title: string; message: string };
type ScanComparison = { headline: string; subline: string; changes: ScanChange[] };

function App() {
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [selectedAction, setSelectedAction] = useState<SelectedDeviceAction | null>(null);
  const [portLabels, setPortLabels] = useState<PortLabels>(() => loadPortLabels());
  const [portMetadata, setPortMetadata] = useState<PortMetadata>(() => loadPortMetadata());
  const [labelingSession, setLabelingSession] = useState<PortLabelingSession>({ active: false, baselinePathIds: [] });
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>(() => loadScanHistory());
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
      const report = payload as LiveScanReport;
      setScan({ status: "ready", report });
      setScanHistory((current) => saveScanHistory(report, current));
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
  const comparison = report && scanHistory[1] ? compareScans(scanHistory[1].report, report, portLabels) : null;

  useEffect(() => {
    if (!report) return;
    setPortMetadata((current) => {
      const next = { ...current };
      for (const device of usbDevices.filter(isPrimaryUserDevice)) {
        const pathId = devicePathId(device);
        const speed = device.negotiated_speed;
        const verifiedNow = Boolean(speed?.is_usb3_or_better);
        next[pathId] = {
          ...next[pathId],
          usb3Verified: Boolean(next[pathId]?.usb3Verified || verifiedNow),
          verifiedWith: verifiedNow ? deviceName(device) : next[pathId]?.verifiedWith,
          verifiedAt: verifiedNow ? report.generated_at : next[pathId]?.verifiedAt,
          lastSeenDevice: deviceName(device),
          lastSeenSpeed: speed?.generation ?? speed?.label ?? "speed unknown",
          lastSeenAt: report.generated_at,
        };
      }
      window.localStorage.setItem("linkmetry.portMetadata", JSON.stringify(next));
      return next;
    });
  }, [report, usbDevices]);

  const selectedDevice = selectedAction ? usbDevices.find((device) => device.id === selectedAction.deviceId) : undefined;
  const selectedStorage = selectedDevice ? storageDevices.find((device) => device.usb_device_id === selectedDevice.id) : undefined;

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Linkmetry USB control panel</p>
          <h1>See what’s plugged in.</h1>
          <p className="lede">
            Scan your USB devices, name your ports, and check drives without digging through system details.
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
              {summary?.subline ?? "Run a quick scan when you are ready. Nothing is tested or changed automatically."}{report?.generated_at ? ` · Refreshed ${new Date(report.generated_at).toLocaleTimeString()}` : ""}
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
      {report ? <PageTabs page={page} onPage={setPage} portCount={Object.keys(portLabels).length} driveCount={storageDevices.filter((device) => device.transport === "usb").length} /> : null}
      {page === "overview" ? (
        <>
          {summary ? <FriendlySummary summary={summary} /> : null}
          {report ? <ScanHistoryPanel comparison={comparison} history={scanHistory} onClear={() => setScanHistory(saveClearedScanHistory())} /> : null}
          {report ? <OverviewNextActions onPage={setPage} portLabelCount={Object.keys(portLabels).length} driveCount={storageDevices.filter((device) => device.transport === "usb").length} /> : null}
          {report ? <ConnectionMap devices={usbDevices} storageDevices={storageDevices} portLabels={portLabels} onLabel={savePortLabel} selectedAction={selectedAction} onAction={setSelectedAction} showPortMapping={false} /> : null}
          {report ? <UsbInventory devices={usbDevices} storageDevices={storageDevices} /> : null}
        </>
      ) : null}
      {page === "ports" && report ? <PortMappingPage devices={usbDevices} storageDevices={storageDevices} portLabels={portLabels} portMetadata={portMetadata} labelingSession={labelingSession} onStartLabeling={startPortLabeling} onStopLabeling={stopPortLabeling} onExportLabels={exportPortLabels} onImportLabels={importPortLabels} onLabel={savePortLabel} onRescan={runScan} scanning={scan.status === "loading"} /> : null}
      {page === "drives" && report ? <DriveDiagnosticsPage cards={storageCards} storageDevices={storageDevices} usbDevices={usbDevices} /> : null}
    </main>
  );
}

function PageTabs({ page, onPage, portCount, driveCount }: { page: Page; onPage: (page: Page) => void; portCount: number; driveCount: number }) {
  return (
    <nav className="pageTabs" aria-label="Linkmetry sections">
      <button type="button" className={page === "overview" ? "active" : ""} onClick={() => onPage("overview")}>Overview</button>
      <button type="button" className={page === "ports" ? "active" : ""} onClick={() => onPage("ports")}>Map ports{portCount ? ` (${portCount})` : ""}</button>
      <button type="button" className={page === "drives" ? "active" : ""} onClick={() => onPage("drives")}>Check drives{driveCount ? ` (${driveCount})` : ""}</button>
    </nav>
  );
}

function OverviewNextActions({ onPage, portLabelCount, driveCount }: { onPage: (page: Page) => void; portLabelCount: number; driveCount: number }) {
  return (
    <section className="overviewActions">
      <button className="overviewActionCard" type="button" onClick={() => onPage("ports")}>
        <span>Map ports</span>
        <strong>{portLabelCount ? `${portLabelCount} saved label${portLabelCount === 1 ? "" : "s"}` : "Name your physical USB ports"}</strong>
        <p>Name ports like “back bottom row, 2 over.” Use the T7 to confirm fast ports.</p>
      </button>
      <button className="overviewActionCard" type="button" onClick={() => onPage("drives")}>
        <span>Check drives</span>
        <strong>{driveCount ? `${driveCount} external drive${driveCount === 1 ? "" : "s"} found` : "No external drives found"}</strong>
        <p>Check external drives without cluttering the main view.</p>
      </button>
    </section>
  );
}

function PortMappingPage({ devices, storageDevices, portLabels, portMetadata, labelingSession, onStartLabeling, onStopLabeling, onExportLabels, onImportLabels, onLabel, onRescan, scanning }: { devices: DiagnosticDevice[]; storageDevices: StorageDevice[]; portLabels: PortLabels; portMetadata: PortMetadata; labelingSession: PortLabelingSession; onStartLabeling: () => void; onStopLabeling: () => void; onExportLabels: () => void; onImportLabels: (labels: PortLabels) => void; onLabel: (pathId: string, label: string) => void; onRescan: () => void; scanning: boolean }) {
  return (
    <section className="portMappingPage">
      <div className="sectionIntro">
        <p className="eyebrow">Map ports</p>
        <h2>Name your USB ports.</h2>
        <p className="muted">Give each physical port a name you’ll recognize later.</p>
      </div>
      <Usb3VerificationGuide />
      <PortMapCards devices={devices} portLabels={portLabels} portMetadata={portMetadata} onLabel={onLabel} />
      <PortFinderGuide devices={devices} storageDevices={storageDevices} portLabels={portLabels} labelingSession={labelingSession} onStartLabeling={onStartLabeling} onStopLabeling={onStopLabeling} onExportLabels={onExportLabels} onImportLabels={onImportLabels} onLabel={onLabel} onRescan={onRescan} scanning={scanning} />
      <ConnectionMap devices={devices} storageDevices={storageDevices} portLabels={portLabels} onLabel={onLabel} selectedAction={null} onAction={() => undefined} showPortMapping />
    </section>
  );
}

function Usb3VerificationGuide() {
  return (
    <section className="card usb3VerifyGuide">
      <p className="eyebrow">Verify port speed</p>
      <h2>Use the T7 to confirm fast ports.</h2>
      <p className="muted">Plug the Samsung T7 into a port, scan again, and Linkmetry will mark that port as fast if it sees USB 3 speed.</p>
      <div className="verifySteps">
        <div><span>1</span><strong>Move the T7</strong><p>Plug the Samsung T7 into the port you want to check.</p></div>
        <div><span>2</span><strong>Rescan</strong><p>If fast USB is seen, the port is marked verified.</p></div>
        <div><span>3</span><strong>Name it</strong><p>Use a label like “back bottom row, 2 over.”</p></div>
      </div>
    </section>
  );
}

function PortMapCards({ devices, portLabels, portMetadata, onLabel }: { devices: DiagnosticDevice[]; portLabels: PortLabels; portMetadata: PortMetadata; onLabel: (pathId: string, label: string) => void }) {
  const currentByPath = new Map(devices.filter(isPrimaryUserDevice).map((device) => [devicePathId(device), device]));
  const paths = Array.from(new Set([...Object.keys(portLabels), ...Object.keys(portMetadata), ...currentByPath.keys()])).sort((a, b) => (portLabels[a] ?? a).localeCompare(portLabels[b] ?? b));

  return (
    <section className="card portMapCard">
      <p className="eyebrow">Your port map</p>
      <h2>{paths.length} mapped or visible port{paths.length === 1 ? "" : "s"}</h2>
      <p className="muted">Your saved port names, what was last plugged in, and whether each port has been confirmed fast.</p>
      <div className="portMapGrid">
        {paths.map((pathId) => {
          const device = currentByPath.get(pathId);
          const meta = portMetadata[pathId];
          const speed = device?.negotiated_speed;
          const usb3Verified = Boolean(meta?.usb3Verified || speed?.is_usb3_or_better);
          const capability = usb3Verified ? "USB 3 verified" : speed?.mbps && speed.mbps <= 480 ? "Only USB 2 seen so far" : "Not checked yet";
          return (
            <article className={`portMapTile ${usb3Verified ? "verified" : "unknown"}`} key={pathId}>
              <span>{capability}</span>
              <strong>{portLabels[pathId] ?? "Unnamed physical port"}</strong>
              <p>{device ? `${deviceName(device)} connected now` : meta?.lastSeenDevice ? `Last seen: ${meta.lastSeenDevice}` : "No recognizable device seen yet"}</p>
              <p className="muted">{speed?.generation ?? speed?.label ?? meta?.lastSeenSpeed ?? "speed not known yet"}</p>
              {usb3Verified ? <p className="verificationNote">Verified with {meta?.verifiedWith ?? deviceName(device!)}.</p> : <p className="verificationNote muted">To check speed: plug in the T7, scan again, then name the port.</p>}
              <PortLabelEditor pathId={pathId} portLabels={portLabels} onLabel={onLabel} />
              <details className="evidencePathDisclosure">
                <summary>Show device ID</summary>
                <p>{pathId}</p>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PreScanCard({ onScan }: { onScan: () => void }) {
  return (
    <section className="card preScanCard">
      <p className="eyebrow">Start here</p>
      <h2>Run a scan when you are ready.</h2>
      <p className="muted">Linkmetry will show what is plugged in, where it is connected, and anything worth checking. Details stay hidden unless you open them.</p>
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
      <p className="muted">No USB data was returned. Try scanning again or check that USB devices are available on this computer.</p>
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
      <h2>What’s plugged in</h2>
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

function ScanHistoryPanel({ comparison, history, onClear }: { comparison: ScanComparison | null; history: ScanHistoryEntry[]; onClear: () => void }) {
  return (
    <section className="card scanHistoryCard">
      <div className="scanHistoryHeader">
        <div>
          <p className="eyebrow">Scan history</p>
          <h2>{comparison?.headline ?? "Baseline saved"}</h2>
          <p className="muted">{comparison?.subline ?? "Run another scan after moving a device and Linkmetry will explain what changed."}</p>
        </div>
        <button type="button" className="plainButton" onClick={onClear} disabled={history.length === 0}>Clear history</button>
      </div>
      {comparison ? (
        <div className="changeList">
          {comparison.changes.map((change, index) => (
            <div className={`changeItem ${change.tone}`} key={`${change.title}-${index}`}>
              <span>{statusLabel(change.tone)}</span>
              <strong>{change.title}</strong>
              <p>{change.message}</p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="historyStrip">
        {history.slice(0, 5).map((entry, index) => (
          <div className={index === 0 ? "active" : ""} key={entry.id}>
            <span>{index === 0 ? "Current scan" : `Previous scan ${index}`}</span>
            <strong>{entry.label}</strong>
            <p>{entry.report.usb.devices.filter(isPrimaryUserDevice).length} visible devices · {entry.report.storage.devices.filter((device) => device.transport === "usb").length} USB drive{entry.report.storage.devices.filter((device) => device.transport === "usb").length === 1 ? "" : "s"}</p>
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
          <p className="muted">Move one device at a time, scan again, and name the port you used.</p>
        </div>
        <div className="portFinderActions">
          {labelingSession.active ? <button className="scanButton small secondary" onClick={onStopLabeling}>Stop labeling</button> : <button className="scanButton small secondary" onClick={onStartLabeling}>Start port labeling</button>}
          <button className="scanButton small secondary" onClick={onRescan} disabled={scanning}>{scanning ? "Scanning…" : "Rescan after moving device"}</button>
        </div>
      </div>
      <div className="portFinderSteps">
        <div><span>1</span><strong>Click Start labeling</strong><p>This saves the current state before you move anything.</p></div>
        <div><span>2</span><strong>Move one obvious device</strong><p>Use the T7 to check speed, or any easy-to-spot device just to identify the port.</p></div>
        <div><span>3</span><strong>Click Rescan</strong><p>Linkmetry shows what moved. If fast USB is seen, the port is marked verified.</p></div>
      </div>
      {labelingSession.active ? (
        <div className={changedCandidates.length > 0 ? "labelingStatus good" : "labelingStatus"}>
          <strong>{changedCandidates.length > 0 ? "Moved device found" : "Ready to map a port"}</strong>
          <p>{changedCandidates.length > 0 ? "Name the port you just used." : "Move one device to the port you want to name, then scan again."}</p>
        </div>
      ) : null}
      {best ? (
        <div className={`portFinderExample ${changedCandidates.includes(best) ? "newPathCandidate" : ""}`}>
          <span>{changedCandidates.includes(best) ? "Moved device" : "Example device"}</span>
          <strong>{deviceName(best)} → {friendlyPortName(best, portLabels)}</strong>
          <p>{changedCandidates.includes(best) ? "Name that port — for example, back bottom row, 2 over." : "Start mapping, move this device, then scan again. Linkmetry will show the port to name."}</p>
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

function ConnectionMap({ devices, storageDevices, portLabels, onLabel, selectedAction, onAction, showPortMapping = false }: { devices: DiagnosticDevice[]; storageDevices: StorageDevice[]; portLabels: PortLabels; onLabel: (pathId: string, label: string) => void; selectedAction: SelectedDeviceAction | null; onAction: (action: SelectedDeviceAction | null) => void; showPortMapping?: boolean }) {
  const map = useMemo(() => buildConnectionMap(devices), [devices]);
  const attachedDevices = useMemo(() => devices.filter((device) => !isPortOrPath(device)).sort(deviceImportanceSort), [devices]);
  const primaryDevices = attachedDevices.filter(isPrimaryUserDevice);
  const accessoryDevices = attachedDevices.filter((device) => !isPrimaryUserDevice(device));
  const storageByUsbId = useMemo(() => new Map(storageDevices.filter((device) => device.usb_device_id).map((device) => [device.usb_device_id, device])), [storageDevices]);
  const externalStorageIds = new Set(storageDevices.map((device) => device.usb_device_id).filter(Boolean));

  return (
    <section className="card connectionMapCard">
      <p className="eyebrow">Devices first</p>
      <h2>{showPortMapping ? "Devices you can use to map ports" : "Devices connected now"}</h2>
      <p className="muted inventoryIntro">{showPortMapping ? "Move one device, scan again, then name the port it used." : "Start here: drives, keyboards, audio gear, receivers, and accessories. Details stay hidden unless you open them."}</p>

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
                {showPortMapping ? <PortLabelEditor pathId={devicePathId(device)} portLabels={portLabels} onLabel={onLabel} /> : null}
                <details className="deviceMoreDetails">
                  <summary>Show more details</summary>
                  <PortSpeedEvidence device={device} storageDevice={storageByUsbId.get(device.id)} />
                  <details className="evidencePathDisclosure">
                    <summary>Show device ID</summary>
                    <p>{devicePathId(device)}</p>
                  </details>
                </details>
                {!showPortMapping ? <DeviceActions device={device} storageDevice={storageByUsbId.get(device.id)} selectedAction={selectedAction} onAction={onAction} /> : null}
                {!showPortMapping && selectedAction?.deviceId === device.id ? (
                  <DeviceActionPanel action={selectedAction.action} device={device} storageDevice={storageByUsbId.get(device.id)} usbDevices={devices} onClose={() => onAction(null)} compact />
                ) : null}
              </div>
            ))}
          {accessoryDevices.length > 0 ? (
            <details className="accessoryDisclosure">
              <summary>
                <span>Details · hidden USB parts</span>
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
                      <summary>Show device ID</summary>
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

      <details className="portDetailsDisclosure" open={showPortMapping || undefined}>
        <summary>
          <span>Details · USB ports and paths</span>
          <strong>Show low-level USB details</strong>
        </summary>
        <p className="muted evidenceNote">Low-level USB details. Helpful for troubleshooting, but not needed for normal use.</p>
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
    ? "This may be normal. Use the T7 if you want to check whether the port itself is fast."
    : isFast
      ? "This path is currently proving USB 3-class speed with the connected device."
      : "This shows the current device speed, not the port’s full potential.";

  return (
    <div className={`portSpeedEvidence ${tone} ${compact ? "compact" : ""}`}>
      <span>Details · {title}</span>
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
      return { tone: "good", label: "Looks good", message: "Drive is on a fast USB connection. Run a read test if you want real speed numbers." };
    }
    if ((storageDevice.usb_link_speed?.mbps ?? Number.POSITIVE_INFINITY) <= 480) {
      return { tone: "warning", label: "Likely bottleneck", message: "Drive may be on a slower USB connection." };
    }
    return { tone: "unknown", label: "Needs test", message: "Drive is detected, but speed is not clear yet." };
  }

  if (speed !== undefined && speed <= 12) {
    return { tone: "info", label: "Normal", message: "Low-bandwidth accessory; slow USB speed is expected here." };
  }

  if (speed !== undefined && speed <= 480 && ["audio", "human-interface", "usb-device"].includes(device.kind)) {
    return { tone: "info", label: "Probably normal", message: "This device probably does not need fast USB." };
  }

  if (device.negotiated_speed?.is_usb3_or_better) {
    return { tone: "good", label: "High-speed", message: "This device is using fast USB." };
  }

  return { tone: "unknown", label: "Unknown", message: "Connected, but speed is not clear yet." };
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
    { label: "Check route", action: "path", enabled: true },
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
          <FriendlyFact label="Device ID" value={device.topology_path ?? device.id} />
          <FriendlyFact label="Device ID" value={`${device.vendor_id ?? "????"}:${device.product_id ?? "????"}`} />
        </div>
      ) : null}

      {action === "path" ? (
        <div className="pathPanel">
          <p className="actionExplanation">{path.length > 1 ? `${deviceName(device)} goes through ${path.length - 1} USB step${path.length - 1 === 1 ? "" : "s"}.` : `${deviceName(device)} appears directly on this Device ID.`}</p>
          {bottleneck ? (
            <div className="pathInsight warningInsight">
              <strong>Possible bottleneck</strong>
              <span>{bottleneck}</span>
            </div>
          ) : (
            <div className="pathInsight">
              <strong>No visible path bottleneck</strong>
              <span>The visible route does not look slower than the device.</span>
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
  return { explain: "Explain this device", details: "Device details", path: "Connection route", speed: "Speed test" }[action];
}

function explainDevice(device: DiagnosticDevice, storageDevice: StorageDevice | undefined, path: DiagnosticDevice[]) {
  const speedLabel = device.negotiated_speed?.label ?? "an unknown USB speed";
  const bottleneck = findPathBottleneck(path);

  if (storageDevice) {
    const mount = benchmarkableMountpoints(storageDevice)[0] ?? storageDevice.mountpoints[0] ?? storageDevice.dev_path;
    if (bottleneck) {
      return `${deviceName(device)} is an external drive, but the visible Device ID may be limiting it: ${bottleneck} It is available at ${mount}. Run the safe read test to compare real throughput with the negotiated link.`;
    }
    return `${deviceName(device)} is an external drive using ${speedLabel}. Nothing obvious looks slow, so the next useful check is an optional read test from ${mount}.`;
  }

  if (device.kind === "hub") {
    return `${deviceName(device)} is part of the Device ID, not usually the thing you test directly. It matters because anything downstream can only perform as well as this path allows.`;
  }

  if ((device.negotiated_speed?.mbps ?? 0) <= 12) {
    return `${deviceName(device)} is a low-bandwidth USB device. That is normal for keyboards, receivers, lighting controllers, and similar accessories, so this is not automatically a problem.`;
  }

  if (bottleneck) {
    return `${deviceName(device)} is connected over ${speedLabel}, but Linkmetry sees a slower upstream step: ${bottleneck}`;
  }

  return `${deviceName(device)} is connected over ${speedLabel}. Linkmetry does not see an obvious upstream bottleneck in the current Linux Device ID.${path.length > 1 ? ` The visible path has ${path.length - 1} upstream step${path.length - 1 === 1 ? "" : "s"}.` : ""}`;
}

function DriveDiagnosticsPage({ cards, storageDevices, usbDevices }: { cards: DeviceCard[]; storageDevices: StorageDevice[]; usbDevices: DiagnosticDevice[] }) {
  const externalIndexes = storageDevices
    .map((device, index) => ({ device, index }))
    .filter(({ device }) => device.transport === "usb");
  const [selectedPath, setSelectedPath] = useState<string | null>(externalIndexes[0]?.device.dev_path ?? null);

  useEffect(() => {
    if (!externalIndexes.length) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !externalIndexes.some(({ device }) => device.dev_path === selectedPath)) {
      setSelectedPath(externalIndexes[0].device.dev_path);
    }
  }, [externalIndexes, selectedPath]);

  const selected = externalIndexes.find(({ device }) => device.dev_path === selectedPath) ?? externalIndexes[0];

  return (
    <section className="deviceCheckSection driveDiagnosticsPage" id="external-drive-diagnostics">
      <div className="sectionIntro">
        <p className="eyebrow">Check drives</p>
        <h2>Choose a drive.</h2>
        <p className="muted">Pick an external drive. Speed tests only run when you click a button.</p>
      </div>
      {externalIndexes.length > 0 ? (
        <>
          <DriveChooser selectedPath={selected?.device.dev_path ?? null} drives={externalIndexes.map(({ device, index }) => ({ device, card: cards[index] }))} onSelect={setSelectedPath} />
          {selected ? <DeviceSummary key={selected.device.dev_path} card={cards[selected.index]} device={selected.device} usbDevices={usbDevices} /> : null}
        </>
      ) : (
        <section className="card"><h2>No external drives found</h2><p className="muted">Plug in an external USB drive to check it.</p></section>
      )}
    </section>
  );
}

function DriveChooser({ drives, selectedPath, onSelect }: { drives: Array<{ device: StorageDevice; card: DeviceCard }>; selectedPath: string | null; onSelect: (path: string) => void }) {
  return (
    <section className="card driveChooserCard">
      <p className="eyebrow">Drives found</p>
      <h2>{drives.length} external drive{drives.length === 1 ? "" : "s"} ready to inspect</h2>
      <div className="driveChooserGrid">
        {drives.map(({ device, card }) => (
          <button type="button" className={device.dev_path === selectedPath ? "active" : ""} key={device.dev_path} onClick={() => onSelect(device.dev_path)}>
            <span>{card.status === "good" ? "Looks good" : card.status === "warning" ? "Needs attention" : "Needs check"}</span>
            <strong>{card.title}</strong>
            <p>{device.usb_link_speed?.generation ?? device.usb_link_speed?.label ?? "USB speed unknown"}</p>
          </button>
        ))}
      </div>
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
          <p className="eyebrow">Details for troubleshooting</p>
          <h2>Low-level USB entries</h2>
          <p className="muted">For troubleshooting only. This includes hubs, controllers, and internal USB parts.</p>
        </div>
        <span className="detailsPill">Show details</span>
      </summary>

      <InventoryGroup title="Accessory details" description="Small USB parts and accessories. Most people can ignore these." devices={groups.peripherals} empty="No accessory details found." />
      <InventoryGroup title="Other detected devices" description="Other USB items that were not shown in the main list." devices={groups.important} empty="No extra devices found." />
      <InventoryGroup title="USB hubs and controllers" description="USB hubs and controllers. Useful for troubleshooting; not counted as normal devices." devices={groups.infrastructure} empty="No hub/controller entries detected." />
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
    subline: `${externalDrives.length} external drive${externalDrives.length === 1 ? "" : "s"} · ${fastDevices.length} fast connection${fastDevices.length === 1 ? "" : "s"} · details available`,
    cards: [
      {
        title: "Devices",
        value: `${humanDevices.length} recognizable item${humanDevices.length === 1 ? "" : "s"}`,
        note: "These are the things a person would recognize, not every internal USB part.",
        tone: "info",
      },
      {
        title: "Attention",
        value: slowStorage.length > 0 ? `${slowStorage.length} drive may be slow` : "Nothing obvious to fix",
        note: slowStorage.length > 0 ? "A drive may be using a slower USB 2-class connection." : "No external drive is clearly stuck on a slow connection.",
        tone: slowStorage.length > 0 ? "warning" : "good",
      },
      {
        title: "Next steps",
        value: "Choose what to do next",
        note: "Map ports or check drives when you need more help.",
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

      {device ? <DriveSafetySummary device={device} card={card} /> : null}
      {device ? <BenchmarkControl device={device} /> : null}
      {device ? <ConnectionPathPanel device={device} path={connectionPath} /> : null}
      {device ? <EvidencePanel device={device} /> : null}
    </section>
  );
}

function DriveSafetySummary({ device, card }: { device: StorageDevice; card: DeviceCard }) {
  const benchmarkMount = benchmarkableMountpoints(device)[0];
  const isFast = Boolean(device.usb_link_speed?.is_usb3_or_better);
  return (
    <div className="driveSafetySummary">
      <div>
        <span>Basic check</span>
        <strong>Done</strong>
        <p>Linkmetry checked the drive name, location, and USB speed. It did not write anything.</p>
      </div>
      <div>
        <span>Current verdict</span>
        <strong>{card.primary_verdict?.title ?? (isFast ? "Looks good" : "Needs a closer look")}</strong>
        <p>{card.primary_verdict?.message ?? "Run the explicit read test only if you want real throughput numbers."}</p>
      </div>
      <div>
        <span>Suggested file area</span>
        <strong>{benchmarkMount ?? "No safe mount found"}</strong>
        <p>{benchmarkMount ? "Use this if you choose to run the read test." : "Linkmetry can’t pick a test location for this drive yet."}</p>
      </div>
    </div>
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
      <p className="eyebrow">Connection route</p>
      <h3>{path.length > 0 ? describePath(path) : `Device ID ${device.usb_device_id}`}</h3>
      <p className="muted">
        {path.length > 0
          ? "This is the route this drive is using right now."
          : "Linux exposed a USB device id, but Linkmetry could not reconstruct the full upstream chain yet."}
      </p>
      {bottleneck ? (
        <div className="pathInsight warningInsight">
          <strong>Potential path bottleneck</strong>
          <span>{bottleneck}</span>
        </div>
      ) : (
        <div className="pathInsight">
          <strong>Connection route looks okay</strong>
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
      setError("Click Pick test file, or paste the full path to a large file on this drive.");
      return;
    }
    if (normalizedTarget.endsWith("/")) {
      setStatus("error");
      setError("That is a folder. Click Pick test file, or paste a full file path inside that folder.");
      return;
    }

    await fetchBenchmark(`/api/benchmark?iterations=3&target=${encodeURIComponent(normalizedTarget)}`);
  }

  async function runAutoBenchmark() {
    const mount = benchmarkMountpoints[0];
    if (!mount) {
      setStatus("error");
      setError("No safe test location was found for this drive.");
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
        <p className="eyebrow">Optional speed test</p>
        <h3>Run a speed check only if you want numbers</h3>
        <p className="muted">This only reads an existing file. It does not write to the drive and never runs by itself.</p>
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
              Pick test file
            </button>
            <button className="scanButton small" onClick={runBenchmark} disabled={status === "running"}>
              {status === "running" ? "Testing…" : "Run speed test"}
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
        <p className="muted benchmarkDisabled">Speed tests are only shown for external USB drives right now.</p>
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
      <p className="eyebrow">Details</p>
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
  return `${deviceName(endpoint)} direct Device ID`;
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


function compareScans(previous: LiveScanReport, current: LiveScanReport, portLabels: PortLabels): ScanComparison {
  const previousDevices = previous.usb.devices.filter(isPrimaryUserDevice);
  const currentDevices = current.usb.devices.filter(isPrimaryUserDevice);
  const previousByIdentity = new Map(previousDevices.map((device) => [deviceIdentityKey(device), device]));
  const currentByIdentity = new Map(currentDevices.map((device) => [deviceIdentityKey(device), device]));
  const changes: ScanChange[] = [];

  for (const device of currentDevices) {
    const key = deviceIdentityKey(device);
    const before = previousByIdentity.get(key);
    if (!before) {
      changes.push({ tone: "info", title: `${deviceName(device)} appeared`, message: `New device detected on ${friendlyPortName(device, portLabels)} at ${device.negotiated_speed?.generation ?? device.negotiated_speed?.label ?? "unknown speed"}.` });
      continue;
    }

    const beforePath = devicePathId(before);
    const afterPath = devicePathId(device);
    if (beforePath !== afterPath) {
      changes.push({ tone: "info", title: `${deviceName(device)} moved`, message: `Moved from ${friendlyPathName(beforePath, portLabels)} to ${friendlyPathName(afterPath, portLabels)}.` });
    }

    const beforeSpeed = before.negotiated_speed?.mbps;
    const afterSpeed = device.negotiated_speed?.mbps;
    if (beforeSpeed && afterSpeed && beforeSpeed !== afterSpeed) {
      changes.push({ tone: afterSpeed > beforeSpeed ? "good" : "warning", title: `${deviceName(device)} speed changed`, message: `Changed from ${before.negotiated_speed?.label ?? `${beforeSpeed} Mbps`} to ${device.negotiated_speed?.label ?? `${afterSpeed} Mbps`}.` });
    }
  }

  for (const device of previousDevices) {
    if (!currentByIdentity.has(deviceIdentityKey(device))) {
      changes.push({ tone: "unknown", title: `${deviceName(device)} disappeared`, message: `It was previously on ${friendlyPortName(device, portLabels)}.` });
    }
  }

  if (changes.length === 0) {
    changes.push({ tone: "good", title: "No visible changes", message: "The same recognizable devices appear to be on the same ports at the same speeds." });
  }

  const important = changes.filter((change) => change.tone === "warning" || change.title.includes("moved") || change.title.includes("speed changed"));
  return {
    headline: important.length > 0 ? `${important.length} important change${important.length === 1 ? "" : "s"} since last scan` : "No important changes since last scan",
    subline: `Compared with ${new Date(previous.generated_at).toLocaleTimeString()}.`,
    changes,
  };
}

function deviceIdentityKey(device: DiagnosticDevice) {
  const serial = device.serial?.trim();
  if (serial) return `serial:${serial}`;
  return [device.vendor_id, device.product_id, device.manufacturer, device.product].filter(Boolean).join(":") || device.id;
}

function friendlyPathName(pathId: string, portLabels: PortLabels) {
  return portLabels[pathId] ? `${portLabels[pathId]} (${pathId})` : `path ${pathId}`;
}

function saveScanHistory(report: LiveScanReport, current: ScanHistoryEntry[]) {
  const entry: ScanHistoryEntry = {
    id: `${report.generated_at}-${Math.random().toString(16).slice(2)}`,
    label: new Date(report.generated_at).toLocaleString(),
    generated_at: report.generated_at,
    report,
  };
  const next = [entry, ...current].slice(0, 8);
  window.localStorage.setItem("linkmetry.scanHistory", JSON.stringify(next));
  return next;
}

function saveClearedScanHistory() {
  window.localStorage.removeItem("linkmetry.scanHistory");
  return [];
}

function loadScanHistory(): ScanHistoryEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("linkmetry.scanHistory") ?? "[]") as ScanHistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function scanStatusLabel(status: ScanState["status"]) {
  return { idle: "Ready to scan", loading: "Scanning live data", ready: "Live data loaded", error: "Live scan error" }[status];
}

function statusLabel(status: StatusTone) {
  return { good: "Looks good", warning: "Needs attention", info: "Info", unknown: "Unknown" }[status];
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

function loadPortMetadata(): PortMetadata {
  try {
    return JSON.parse(window.localStorage.getItem("linkmetry.portMetadata") ?? "{}") as PortMetadata;
  } catch {
    return {};
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
