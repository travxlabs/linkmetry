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

type Fact = {
  label: string;
  value: string;
};

type DeviceCard = {
  title: string;
  subtitle?: string;
  status: StatusTone;
  badges: string[];
  primary_verdict?: Verdict;
  facts: Fact[];
};

type Evidence = {
  source: string;
  key: string;
  value: string;
};

type LinkSpeed = {
  raw: string;
  mbps?: number;
  label: string;
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

type LiveStorageReport = {
  generated_at: string;
  platform: string;
  devices: StorageDevice[];
  cards: DeviceCard[];
};

type ScanState =
  | { status: "loading"; report?: LiveStorageReport; error?: undefined }
  | { status: "ready"; report: LiveStorageReport; error?: undefined }
  | { status: "error"; report?: LiveStorageReport; error: string };

function App() {
  const [scan, setScan] = useState<ScanState>({ status: "loading" });

  async function runScan() {
    setScan((current) => ({ status: "loading", report: current.report }));
    try {
      const response = await fetch("/api/storage-cards", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Scan failed with HTTP ${response.status}`);
      }
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
  const devices = report?.devices ?? [];
  const cards = report?.cards ?? [];
  const usbCount = devices.filter((device) => device.transport === "usb").length;

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Linkmetry live prototype</p>
          <h1>Connection health, without the guessing.</h1>
          <p className="lede">
            This view now calls the Rust Linux inspector on trav-dev and renders live storage/device-card data from sysfs instead of baked sample data.
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
            <h2>{cards.length} storage path{cards.length === 1 ? "" : "s"} detected</h2>
            <p className="muted">
              {usbCount} USB-backed · Platform: {report?.platform ?? "linux"}
              {report?.generated_at ? ` · Refreshed ${new Date(report.generated_at).toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="badges">
            <span>Live Rust output</span>
            <span>Read-only scan</span>
          </div>
        </div>
        {scan.status === "error" ? <p className="errorText">{scan.error}</p> : null}
      </section>

      {scan.status === "loading" && !report ? <LoadingCard /> : null}
      {scan.status !== "loading" && cards.length === 0 ? <EmptyCard /> : null}

      {cards.map((card, index) => (
        <React.Fragment key={devices[index]?.dev_path ?? card.subtitle ?? card.title}>
          <DeviceSummary card={card} device={devices[index]} />
          <EvidencePanel device={devices[index]} />
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
      <p className="muted">This runs the Linkmetry CLI locally on trav-dev and returns normalized device cards.</p>
    </section>
  );
}

function EmptyCard() {
  return (
    <section className="card">
      <p className="eyebrow">No storage devices</p>
      <h2>No inspectable storage paths were returned.</h2>
      <p className="muted">Plug in an external drive or confirm Linux exposes it under /sys/class/block.</p>
    </section>
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
          {card.badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
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

function scanStatusLabel(status: ScanState["status"]) {
  return {
    loading: "Scanning live data",
    ready: "Live data loaded",
    error: "Live scan error",
  }[status];
}

function statusLabel(status: StatusTone) {
  return {
    good: "Healthy path",
    warning: "Needs attention",
    info: "Informational",
    unknown: "Unknown",
  }[status];
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
