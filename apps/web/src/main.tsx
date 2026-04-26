import React from "react";
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

type StorageDevice = {
  name: string;
  dev_path: string;
  model?: string;
  vendor?: string;
  size_bytes?: number;
  transport?: string;
  mountpoints: string[];
  usb_device_id?: string;
  usb_link_speed?: { raw: string; mbps?: number; label: string };
  verdicts: Verdict[];
};

type DiagnosisReport = {
  target: string;
  storage: StorageDevice;
  card: DeviceCard;
  benchmark: BenchmarkResult;
  verdicts: Verdict[];
};

const sampleReport: DiagnosisReport = {
  target: "/mnt/t7/videos/obs/2026-04-21 12-29-35.mp4",
  storage: {
    name: "sdb",
    dev_path: "/dev/sdb",
    model: "PSSD T7 Shield",
    vendor: "Samsung",
    size_bytes: 4000787030016,
    transport: "usb",
    mountpoints: ["/mnt/t7", "/home/brad/Videos"],
    usb_device_id: "2-7.2",
    usb_link_speed: {
      raw: "5000",
      mbps: 5000,
      label: "USB 3.x SuperSpeed (5 Gbps)",
    },
    verdicts: [
      {
        title: "External USB storage detected",
        message:
          "This storage device is attached through USB and the OS reports USB 3.x SuperSpeed (5 Gbps). Benchmarking comes next to verify real-world throughput.",
        confidence: "high",
        evidence_keys: ["sysfs_path", "usb_device_id", "usb_speed"],
      },
    ],
  },
  card: {
    title: "PSSD T7 Shield",
    subtitle: "/dev/sdb",
    status: "good",
    badges: ["USB", "USB 3.x SuperSpeed (5 Gbps)", "3.6 TiB"],
    primary_verdict: {
      title: "Read speed looks healthy for a 5 Gbps USB path",
      message:
        "Average read speed was 431 MiB/s on a USB 3.x SuperSpeed (5 Gbps) link. That is in the expected real-world range for many 5 Gbps external SSD paths.",
      confidence: "high",
      evidence_keys: ["usb_speed", "benchmark"],
    },
    facts: [
      { label: "Device", value: "/dev/sdb" },
      { label: "Vendor", value: "Samsung" },
      { label: "USB link", value: "USB 3.x SuperSpeed (5 Gbps)" },
      { label: "Mounts", value: "/mnt/t7, /home/brad/Videos" },
    ],
  },
  benchmark: {
    kind: "read-file",
    target: "/mnt/t7/videos/obs/2026-04-21 12-29-35.mp4",
    bytes: 2238712217,
    iterations: 3,
    runs: [
      { bytes_read: 2238712217, elapsed_seconds: 5.16, mib_per_second: 413.5 },
      { bytes_read: 2238712217, elapsed_seconds: 4.86, mib_per_second: 439.2 },
      { bytes_read: 2238712217, elapsed_seconds: 4.81, mib_per_second: 443.1 },
    ],
    average_mib_per_second: 431.9,
    best_mib_per_second: 443.1,
    caveats: [
      "Read-only file benchmark; results may be affected by OS page cache.",
      "This does not test write speed and does not modify the target drive.",
    ],
  },
  verdicts: [
    {
      title: "Read speed looks healthy for a 5 Gbps USB path",
      message:
        "Average read speed was 431 MiB/s on a USB 3.x SuperSpeed (5 Gbps) link. That is in the expected real-world range for many 5 Gbps external SSD paths.",
      confidence: "high",
      evidence_keys: ["usb_speed", "benchmark"],
    },
  ],
};

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Linkmetry prototype</p>
          <h1>Connection health, without the guessing.</h1>
          <p className="lede">
            First UI pass for the Linux storage diagnosis flow. This renders the same
            card model emitted by the Rust CLI, with safe benchmark context and evidence.
          </p>
        </div>
        <button className="scanButton">Run scan</button>
      </section>

      <DeviceSummary report={sampleReport} />
      <BenchmarkPanel benchmark={sampleReport.benchmark} />
      <EvidencePanel report={sampleReport} />
    </main>
  );
}

function DeviceSummary({ report }: { report: DiagnosisReport }) {
  const verdict = report.card.primary_verdict;

  return (
    <section className="card deviceCard">
      <div className="cardTopline">
        <span className={`statusDot ${report.card.status}`} />
        <span className="statusText">{statusLabel(report.card.status)}</span>
      </div>
      <div className="deviceHeader">
        <div>
          <h2>{report.card.title}</h2>
          <p>{report.card.subtitle}</p>
        </div>
        <div className="badges">
          {report.card.badges.map((badge) => (
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
        {report.card.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BenchmarkPanel({ benchmark }: { benchmark: BenchmarkResult }) {
  const max = Math.max(...benchmark.runs.map((run) => run.mib_per_second));

  return (
    <section className="card splitCard">
      <div>
        <p className="eyebrow">Safe benchmark</p>
        <h2>{benchmark.average_mib_per_second.toFixed(0)} MiB/s average read</h2>
        <p className="muted">
          Best run: {benchmark.best_mib_per_second.toFixed(0)} MiB/s · {benchmark.iterations} read-only passes
        </p>
        <ul className="caveats">
          {benchmark.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>
      <div className="runs">
        {benchmark.runs.map((run, index) => (
          <div className="run" key={index}>
            <div className="runLabel">
              <span>Run {index + 1}</span>
              <strong>{run.mib_per_second.toFixed(0)} MiB/s</strong>
            </div>
            <div className="barTrack">
              <span style={{ width: `${(run.mib_per_second / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidencePanel({ report }: { report: DiagnosisReport }) {
  return (
    <section className="card evidenceCard">
      <p className="eyebrow">Detected evidence</p>
      <h2>Why Linkmetry thinks this path is healthy</h2>
      <div className="evidenceList">
        <EvidenceItem label="Target file" value={report.target} />
        <EvidenceItem label="Storage path" value={`${report.storage.vendor ?? ""} ${report.storage.model ?? report.storage.dev_path}`.trim()} />
        <EvidenceItem label="USB device id" value={report.storage.usb_device_id ?? "Unavailable"} />
        <EvidenceItem label="Negotiated link" value={report.storage.usb_link_speed?.label ?? "Unavailable"} />
        <EvidenceItem label="Mounted at" value={report.storage.mountpoints.join(", ")} />
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
