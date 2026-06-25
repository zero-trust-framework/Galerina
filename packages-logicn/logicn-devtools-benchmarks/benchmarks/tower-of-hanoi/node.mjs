import { performance } from "node:perf_hooks";

// Tower of Hanoi with a THREADED move-checksum. Every one of the 2^n-1 moves is executed and folded into
// acc = (acc*31 + moveCode) % 65521 — a real recursion+arithmetic workload (not the 2^n-1 closed form),
// kept < 2^31 so it is cross-language-identical AND safe in LogicN's overflow-trapping i32. Peg encoding
// 0=source, 2=target, 1=auxiliary; seed 0. The `result` is the deterministic checksum (cross-language oracle).
const DEFAULT_N = 16;          // 65,535 moves per call
const DEFAULT_ITERATIONS = 200;

function hanoi(n, from, to, aux, acc) {
  if (n === 0) return acc;
  const a1 = hanoi(n - 1, from, aux, to, acc);
  const moveCode = n * 36 + from * 6 + to;
  const mixed = (a1 * 31 + moveCode) % 65521;
  return hanoi(n - 1, aux, to, from, mixed);
}

const moves = (n) => Math.pow(2, n) - 1;

function runBench(n, iterations) {
  hanoi(n, 0, 2, 1, 0); // warmup
  if (typeof globalThis.gc === "function") globalThis.gc();
  const __memBefore = process.memoryUsage();
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  let result = 0;
  for (let i = 0; i < iterations; i++) result = hanoi(n, 0, 2, 1, 0);
  const elapsedMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const mem = process.memoryUsage();
  const totalMoves = moves(n) * iterations;
  return {
    runtime: "nodejs", benchmark: "tower-of-hanoi-v1",
    n, result, iterations, movesPerCall: moves(n),
    elapsedMs: Number(elapsedMs.toFixed(3)),
    movesPerSecond: Number((totalMoves / (elapsedMs / 1000)).toFixed(2)),
    iterationsPerSecond: Number((iterations / (elapsedMs / 1000)).toFixed(2)),
    cpu: { totalMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)) },
    memory: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, maxRssBytes: null, heapUsedBefore: __memBefore.heapUsed, heapUsedDelta: mem.heapUsed - __memBefore.heapUsed },
    process: { pid: process.pid, node: process.version, platform: process.platform, arch: process.arch },
  };
}

function parseIntFlag(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? parseInt(process.argv[idx + 1] || "", 10) || fallback : fallback;
}
const n = parseIntFlag("--n", DEFAULT_N);
const its = parseIntFlag("--operations", parseIntFlag("--iterations", DEFAULT_ITERATIONS));
console.log(JSON.stringify(runBench(n, its), null, 2));
