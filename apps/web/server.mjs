import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.env.PORT ?? 9000);
const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const distRoot = join(repoRoot, "apps", "web", "dist");

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

    if (url.pathname === "/api/benchmark") {
      const target = url.searchParams.get("target");
      const iterations = url.searchParams.get("iterations") ?? "3";
      if (!target) return sendJson(res, { error: "target query parameter is required" }, 400);
      const payload = await runCli(["diagnose-storage", "--iterations", iterations, target]);
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

function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("cargo", ["run", "--quiet", "-p", "linkmetry-cli", "--", ...args], {
      cwd: repoRoot,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
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
