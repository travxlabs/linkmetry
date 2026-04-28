import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.env.PORT ?? 9000);
const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const distRoot = join(repoRoot, "apps", "web", "dist");
const dataRoot = resolve(process.env.LINKMETRY_DATA_DIR ?? join(repoRoot, ".linkmetry-data"));
const appDataPath = join(dataRoot, "app-data.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/app-data" && req.method === "GET") {
      return sendJson(res, readAppData());
    }

    if (url.pathname === "/api/app-data" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const saved = writeAppData(payload);
      return sendJson(res, saved);
    }

    if (url.pathname === "/api/scan") {
      const [usb, storage] = await Promise.all([runCli(["inspect"]), runCli(["storage-cards"])]);
      return sendJson(res, {
        generated_at: new Date().toISOString(),
        platform: storage.platform ?? usb.platform,
        usb: { devices: usb.devices ?? [] },
        storage: { devices: storage.devices ?? [], cards: storage.cards ?? [] },
      });
    }

    if (url.pathname === "/api/storage-cards") {
      const payload = await runCli(["storage-cards"]);
      return sendJson(res, {
        generated_at: new Date().toISOString(),
        ...payload,
      });
    }

    if (url.pathname === "/api/benchmark/auto") {
      const mount = url.searchParams.get("mount");
      const iterations = url.searchParams.get("iterations") ?? "3";
      if (!mount) return sendJson(res, { error: "mount query parameter is required" }, 400);
      const target = findTestFile(mount);
      if (!target) {
        return sendJson(res, { error: `No large readable test file found under ${mount}. Add or choose a large file manually.` }, 404);
      }
      const payload = await runCli(["diagnose-storage", "--iterations", iterations, target], 180_000);
      return sendJson(res, {
        generated_at: new Date().toISOString(),
        ...payload,
      });
    }

    if (url.pathname === "/api/benchmark") {
      const target = url.searchParams.get("target");
      const iterations = url.searchParams.get("iterations") ?? "3";
      if (!target) return sendJson(res, { error: "target query parameter is required" }, 400);
      if (target.endsWith("/")) return sendJson(res, { error: "Choose a specific large file, not a folder/mount point." }, 400);
      const payload = await runCli(["diagnose-storage", "--iterations", iterations, target], 180_000);
      return sendJson(res, {
        generated_at: new Date().toISOString(),
        ...payload,
      });
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, { ok: true });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    return sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Linkmetry live preview listening on http://0.0.0.0:${port}`);
});

function defaultAppData() {
  return {
    version: 1,
    portLabels: {},
    portMetadata: {},
    knownDevices: {},
    scanHistory: [],
    updatedAt: null,
  };
}

function readAppData() {
  try {
    if (!existsSync(appDataPath)) return defaultAppData();
    return { ...defaultAppData(), ...JSON.parse(readFileSync(appDataPath, "utf8")) };
  } catch (error) {
    return { ...defaultAppData(), error: `Could not read app data: ${error.message}` };
  }
}

function writeAppData(payload) {
  const current = readAppData();
  const next = {
    version: 1,
    portLabels: isPlainObject(payload.portLabels) ? payload.portLabels : current.portLabels,
    portMetadata: isPlainObject(payload.portMetadata) ? payload.portMetadata : current.portMetadata,
    knownDevices: isPlainObject(payload.knownDevices) ? payload.knownDevices : current.knownDevices,
    scanHistory: Array.isArray(payload.scanHistory) ? payload.scanHistory.slice(0, 20) : current.scanHistory,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(appDataPath, JSON.stringify(next, null, 2));
  return next;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolvePromise(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function runCli(args, timeoutMs = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("cargo", ["run", "--quiet", "-p", "linkmetry-cli", "--", ...args], {
      cwd: repoRoot,
      env: process.env,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`linkmetry-cli timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `linkmetry-cli exited with ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse linkmetry-cli JSON: ${error.message}`));
      }
    });
  });
}

function findTestFile(mount) {
  const mountPath = resolve(mount);
  const allowedRoots = ["/mnt", "/home/brad/Videos", "/home/brad/Documents"].map((root) => resolve(root));
  if (!allowedRoots.some((root) => mountPath === root || mountPath.startsWith(`${root}/`))) return null;
  if (!existsSync(mountPath) || !statSync(mountPath).isDirectory()) return null;

  const ignoredDirectories = new Set([".git", "node_modules", "target"]);
  const stack = [mountPath];
  let bestPath = null;
  let bestSize = 0;
  let scanned = 0;

  while (stack.length > 0 && scanned <= 2_000) {
    const current = stack.shift();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      try {
        const size = statSync(entryPath).size;
        if (size >= 50 * 1024 * 1024 && size > bestSize) {
          bestPath = entryPath;
          bestSize = size;
        }
      } catch {
        // Skip unreadable or disappearing files.
      }
      if (scanned > 2_000) break;
    }
  }

  return bestPath;
}

function serveStatic(pathname, res) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(distRoot, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(distRoot) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distRoot, "index.html");
  }

  res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}
