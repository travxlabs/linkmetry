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
  const sortedDevices = useMemo(
    () => [...devices].sort((a, b) => sortSpeed(b) - sortSpeed(a) || a.id.localeCompare(b.id)),
    [devices],
  );

  return (
    <section className="card">
      <p className="eyebrow">USB inventory</p>
      <h2>What is plugged into the USB tree</h2>
      <div className="usbGrid">
        {sortedDevices.map((device) => (
          <UsbDeviceTile key={device.id} device={device} />
        ))}
      </div>
    </section>
  );
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
    </section>
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
