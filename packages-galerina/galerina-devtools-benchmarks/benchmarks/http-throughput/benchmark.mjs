/**
 * http-throughput benchmark — measure requests/sec on localhost
 *
 * Tests:
 *   1. Raw Node.js HTTP (baseline — no framework, no governance)
 *   2. Galerina governed endpoint (route-dispatcher → governance → response)
 *
 * Each test:
 *   - Starts a server on a random port
 *   - Fires N sequential GET requests (localhost RTT ~0.1ms)
 *   - Measures wall time → compute req/sec and latency p50/p99
 *
 * Sequential (not concurrent) to isolate server throughput from client parallelism.
 */
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── HTTP client helper ────────────────────────────────────────────────────────
function httpGet(port, path = "/health") {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = import("node:http").then(({ request }) => {
      const r = request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ latencyMs: performance.now() - t0, status: res.statusCode, body: data }));
      });
      r.on("error", reject);
      r.end();
    });
  });
}

// ── Percentile helper ─────────────────────────────────────────────────────────
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p / 100)] ?? 0;
}

// ── Benchmark: raw Node.js server ────────────────────────────────────────────
async function benchmarkNodeRaw(requests = 500) {
  const latencies = [];
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok","runtime":"nodejs-raw"}');
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  // Warmup
  for (let i = 0; i < 20; i++) await httpGet(port);

  const t0 = performance.now();
  for (let i = 0; i < requests; i++) {
    const { latencyMs } = await httpGet(port);
    latencies.push(latencyMs);
  }
  const elapsedMs = performance.now() - t0;

  server.close();
  return {
    runtime: "nodejs-raw",
    server: "node:http (no framework)",
    requests,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    requestsPerSecond: Number((requests / (elapsedMs / 1000)).toFixed(1)),
    latencyMs: {
      p50: Number(percentile(latencies, 50).toFixed(2)),
      p95: Number(percentile(latencies, 95).toFixed(2)),
      p99: Number(percentile(latencies, 99).toFixed(2)),
      mean: Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)),
    },
  };
}

// ── Benchmark: Galerina governed server ────────────────────────────────────────
async function benchmarkGalerinaGoverned(requests = 200) {
  const latencies = [];

  // Start the Galerina server via the serve-galerina.mjs shim
  const shimPath = join(__dir, "serve-galerina.mjs");
  const serverProc = spawn("node", [shimPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  let port = null;
  const portPromise = new Promise((resolve, reject) => {
    let buf = "";
    serverProc.stdout.on("data", chunk => {
      buf += chunk;
      const m = buf.match(/"port":(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    });
    serverProc.on("error", reject);
    setTimeout(() => reject(new Error("Server startup timeout")), 10000);
  });

  try {
    port = await portPromise;
  } catch (e) {
    serverProc.kill();
    return { runtime: "galerina-governed", error: true, reason: String(e) };
  }

  // Warmup
  for (let i = 0; i < 10; i++) {
    try { await httpGet(port, "/health"); } catch { /* ignore warmup errors */ }
  }

  const t0 = performance.now();
  let errors = 0;
  for (let i = 0; i < requests; i++) {
    try {
      const { latencyMs } = await httpGet(port, "/health");
      latencies.push(latencyMs);
    } catch {
      errors++;
    }
  }
  const elapsedMs = performance.now() - t0;
  serverProc.kill();

  return {
    runtime: "galerina-governed",
    server: "Galerina route-dispatcher → governance → audit → response",
    requests,
    errors,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    requestsPerSecond: Number(((requests - errors) / (elapsedMs / 1000)).toFixed(1)),
    latencyMs: latencies.length > 0 ? {
      p50: Number(percentile(latencies, 50).toFixed(2)),
      p95: Number(percentile(latencies, 95).toFixed(2)),
      p99: Number(percentile(latencies, 99).toFixed(2)),
      mean: Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)),
    } : null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const requests = parseInt(args.find(a => a.startsWith("--requests="))?.split("=")[1] ?? "500");
const skipGalerina = args.includes("--skip-galerina");

const nodeResult = await benchmarkNodeRaw(requests);
const galerinaResult = skipGalerina ? { runtime: "galerina-governed", skipped: true }
                                : await benchmarkGalerinaGoverned(Math.min(requests, 200));

console.log(JSON.stringify({
  benchmark: "http-throughput-v1",
  date: new Date().toISOString(),
  note: "Sequential requests (no concurrency). Measures server-side throughput, not client parallelism.",
  results: { nodeRaw: nodeResult, galerinaGoverned: galerinaResult },
}, null, 2));
