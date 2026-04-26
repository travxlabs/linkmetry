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

function App() {
  const [scan, setScan] = useState<ScanState>({ status: "loading" });

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

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Linkmetry live prototype</p>
          <h1>Connection health, without the guessing.</h1>
          <p className="lede">
            Live Linux scan from the Rust inspector: USB inventory, storage paths, negotiated speeds, evidence, and plain-English verdicts.
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
            <h2>{usbDevices.length} USB device{usbDevices.length === 1 ? "" : "s"} · {storageCards.length} storage path{storageCards.length === 1 ? "" : "s"}</h2>
            <p className="muted">
              {highSpeedUsbCount} high-speed USB · {usbStorageCount} USB-backed storage · Platform: {report?.platform ?? "linux"}
              {report?.generated_at ? ` · Refreshed ${new Date(report.generated_at).toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="badges">
            <span>Live Rust output</span>
            <span>Read-only scan</span>
            <span>Linux sysfs</span>
          </div>
        </div>
        {scan.status === "error" ? <p className="errorText">{scan.error}</p> : null}
      </section>

      {scan.status === "loading" && !report ? <LoadingCard /> : null}
      {scan.status !== "loading" && report && usbDevices.length === 0 ? <EmptyCard /> : null}

      {report ? <UsbInventory devices={usbDevices} /> : null}

      {storageCards.map((card, index) => (
        <React.Fragment key={storageDevices[index]?.dev_path ?? card.subtitle ?? card.title}>
          <DeviceSummary card={card} device={storageDevices[index]} />
          <EvidencePanel device={storageDevices[index]} />
        </React.Fragment>
      ))}
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

function UsbInventory({ devices }: { devices: DiagnosticDevice[] }) {
  const groups = useMemo(() => groupUsbDevices(devices), [devices]);

  return (
    <section className="card">
      <p className="eyebrow">USB inventory</p>
      <h2>What is plugged into the USB tree</h2>
      <p className="muted inventoryIntro">
        Linkmetry now separates likely user-facing devices from background hubs/controllers so the useful signal is easier to see.
      </p>

      <InventoryGroup title="Likely important" description="Storage, audio/video, network, and high-speed attached devices." devices={groups.important} empty="No standout user-facing devices detected." />
      <InventoryGroup title="Peripherals" description="Keyboards, receivers, lighting controllers, and low-bandwidth USB devices." devices={groups.peripherals} empty="No low-bandwidth peripherals detected." />
      <InventoryGroup title="Hubs & controllers" description="USB hubs, root buses, and controller paths that explain topology but are usually not the thing you care about first." devices={groups.infrastructure} empty="No hub/controller devices detected." collapsed />
    </section>
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

function DeviceSummary({ card, device }: { card: DeviceCard; device?: StorageDevice }) {
  const verdict = card.primary_verdict;

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

      <dl className="factsGrid">
        {card.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
        {device?.usb_device_id ? (
          <div>
            <dt>Topology</dt>
            <dd>{device.usb_device_id}</dd>
          </div>
        ) : null}
      </dl>

      {device ? <BenchmarkControl device={device} /> : null}
    </section>
  );
}

function BenchmarkControl({ device }: { device: StorageDevice }) {
  const defaultTarget = device.mountpoints[0] ?? "";
  const [target, setTarget] = useState(defaultTarget);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<StorageDiagnosisReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBenchmark() {
    if (!target.trim()) {
      setStatus("error");
      setError("Choose a readable file path on this drive first.");
      return;
    }

    setStatus("running");
    setError(null);
    try {
      const response = await fetch(`/api/benchmark?iterations=3&target=${encodeURIComponent(target.trim())}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Benchmark failed with HTTP ${response.status}`);
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
        <p className="eyebrow">Read benchmark</p>
        <h3>Test real-world read speed</h3>
        <p className="muted">Safe read-only test. Pick a large existing file on this storage path; Linkmetry does not write to the drive.</p>
      </div>
      <div className="benchmarkControls">
        <input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder={defaultTarget ? `${defaultTarget}/path/to/large-file` : "/path/to/large-file"}
        />
        <button className="scanButton small" onClick={runBenchmark} disabled={status === "running"}>
          {status === "running" ? "Testing…" : "Run read test"}
        </button>
      </div>
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
      <p className="eyebrow">Detected evidence</p>
      <h2>What Linux exposed for {device.dev_path}</h2>
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
