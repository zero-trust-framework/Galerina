import { spawnSync, execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { benchmarkSpec, normalizeThroughput, assertBenchmarkUnits } from "./throughput-units.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const benchDir   = join(__dirname, "..", "benchmarks");
const resultsDir  = join(__dirname, "..", "results");

// opsPerRun: how many operations the Galerina .spore benchmark does per flow call.
// Used to normalise runsPerSecond → ops/second for fair comparison.
// passiveCallCount: how many outer-loop calls to make in passive mode.
//   Heavy benchmarks (internal loops doing thousands of ops): use 3 calls
//   → just enough to measure warm-path overhead without running for minutes.
//   Light benchmarks (tiny single-op flows): use 1000 calls
//   → gives stable throughput measurement.
//
// Rule of thumb: passiveCallCount × execMs < 1000ms (keep passive < 1s total)
const BENCHMARKS = [
  { id: "compute-mix",          dir: "compute-mix",          galerinaOpsPerRun: 50000, timeBased: true, passiveCallCount: 3  },
  { id: "arithmetic-threshold", dir: "arithmetic-threshold", galerinaOpsPerRun: null,                   passiveCallCount: 3  },
  { id: "six-digit-guess",      dir: "six-digit-guess",      galerinaOpsPerRun: null,                   passiveCallCount: 3  },
  { id: "record-allocation",    dir: "record-allocation",    galerinaOpsPerRun: 10000,                  passiveCallCount: 20 },
  { id: "fibonacci-recursive",  dir: "fibonacci-recursive",  galerinaOpsPerRun: 1,                      passiveCallCount: 5  },
  // Tower of Hanoi (n=16) with a threaded move-checksum — 65,535 moves/call, deep recursion + per-move
  // governed arithmetic. galerinaOpsPerRun = moves/call so the Galerina column reports moves/sec like the others;
  // `result` (=42452 at n=16) is the cross-language checksum oracle (all runtimes must agree).
  { id: "tower-of-hanoi",       dir: "tower-of-hanoi",       galerinaOpsPerRun: 65535,                  passiveCallCount: 2  },
  { id: "collection-pipeline",  dir: "collection-pipeline",  galerinaOpsPerRun: 10000,                  passiveCallCount: 30 },
  { id: "governance-cost",      dir: "governance-cost",      galerinaOpsPerRun: 1,                      passiveCallCount: 100 },
  { id: "hardware-targets",     dir: "hardware-targets",     galerinaOpsPerRun: 1,                      passiveCallCount: 1000 },
  // Low-memory: measures heap bytes allocated per operation.
  // KEY METRIC: bytesPerOperation — WASM/Rust/Node ~0, tree-walker ~200-400 bytes/op.
  // processStream(10000) does 10000 inner iterations (validate + classify per item).
  { id: "low-memory",          dir: "low-memory",           galerinaOpsPerRun: 10000,                  passiveCallCount: 20   },
  // GPU-compute: parallel map-reduce kernel — a GPU-SHAPED workload run on CPU.
  // mapReduce(100000) does 100000 per-element kernel evaluations.
  // GPU columns are filled by gpu-detect (toolchain-gated); Galerina GPU = pending Phase 38.
  { id: "gpu-compute",         dir: "gpu-compute",          galerinaOpsPerRun: 100000,                 passiveCallCount: 10   },
  // Matrix multiply: canonical float32 GEMM at two scales (32×32 and 64×64).
  // Galerina uses scaled integer arithmetic (×1000) for the WASM path.
  // Key question: does WASM SIMD beat CPU, and at what scale does WebGPU win?
  { id: "matrix-multiply", dir: "matrix-multiply", galerinaOpsPerRun: 32 * 32, passiveCallCount: 5 },
  // Crypto-ops: SHA-256 bulk hashing, HMAC-SHA256, Ed25519 sign+verify.
  // WASM column is N/A — crypto delegates to the host capability.
  // Galerina stub documents the governance model (crypto.verify effect required).
  { id: "crypto-ops", dir: "crypto-ops", galerinaOpsPerRun: 1, passiveCallCount: 100 },
  // Text/HTML: string processing workload for web services.
  // Galerina string flows go through the sync tree-walker (not the integer bytecode VM).
  // Key question: how fast is WASM for string ops, and is the governed path viable for text work?
  { id: "text-html", dir: "text-html", galerinaOpsPerRun: 1, passiveCallCount: 100 },
  // HTTP-throughput: localhost req/s — Node.js raw vs Galerina governed endpoint.
  // Uses a server-lifecycle harness (benchmark.mjs), not the standard file pattern,
  // so it is intentionally NOT in this array. Run it standalone: `npm run run:http`.
  // Tri-logic: 3-valued ternary logic (True=1, False=-1, Unknown=0) — all 27 truth table combinations.
  // Relevant for future photonic compute substrates; validates correctness and shows CPU overhead today.
  { id: "tri-logic", dir: "tri-logic", galerinaOpsPerRun: 27000, passiveCallCount: 100 },
  // Data-query: SQL-like data filtering on arrays of JSON records — a core web service workload.
  // Galerina governed path validates query inputs as Tainted<String> before execution.
  { id: "data-query", dir: "data-query", galerinaOpsPerRun: 1000, passiveCallCount: 50 },
  // Call-chain: layered call-dispatch overhead — controller → service.method → util fn.
  // In Galerina: main → serviceLayer → domainLayer → leafCompute (7 flow calls per chain).
  // One op = one outer chain; 50,000 chains per run. Isolates flow-call cost (arg binding
  // + governed frame), salted by loop index so the pure-flow memo cache never short-circuits.
  { id: "call-chain", dir: "call-chain", galerinaOpsPerRun: 50000, passiveCallCount: 5 },
  // N-body: pairwise gravitational force (scaled-integer, governed). One run =
  // simulate(64, 8) = steps×n×n = 32,768 softened inverse-distance force evals.
  // Array-free index-math kernel; checksum (536024) is identical across Node,
  // Python and the Galerina integer path. Physics-shaped compute throughput test.
  { id: "nbody", dir: "nbody", galerinaOpsPerRun: 32768, passiveCallCount: 5 },
  // JSON-parse: key:value record scanning (the expensive part of real JSON workloads) —
  // split records on ',', split fields on ':', accumulate field counts + value lengths.
  // One run = scanRecords(500) = 500 records parsed. split/length match JS/Python exactly,
  // so the checksum (12500) is identical across Node, Python and the Galerina string path.
  { id: "json-parse", dir: "json-parse", galerinaOpsPerRun: 500, passiveCallCount: 20 },
  // ── Real-world cross-language benchmarks (Computer Language Benchmarks Game) ──
  // mandelbrot: scaled-int escape-time over a 128×128 grid (16384 px), max 100 iters.
  // One op = one pixel; checksum = Σ iteration counts (identical across runtimes).
  { id: "mandelbrot", dir: "mandelbrot", galerinaOpsPerRun: 16384, passiveCallCount: 5 },
  // spectral-norm: scaled-int, index-math (no arrays). n=100, 10 power-iterations →
  // 10×2×n² = 200000 A(i,j) evaluations per run. One op = one A-eval.
  { id: "spectral-norm", dir: "spectral-norm", galerinaOpsPerRun: 200000, passiveCallCount: 5 },
  // binary-trees: THE allocation/GC benchmark. minDepth 4, maxDepth 10 → 135854 nodes
  // allocated per run. One op = one node allocated. Read the bytes/op column here.
  { id: "binary-trees", dir: "binary-trees", galerinaOpsPerRun: 135854, passiveCallCount: 3 },
  // ── .tmf trust-container CREATION — TMX-256 SHAKE Merkle + LE container packing ──
  // The Node.js column IS the shipped @galerina/ext-tmf engine (pure TS/Node — no .spore
  // path exists); python.py / bench.rs are byte-identical reference writers that assert
  // the SAME golden root. Honest "can other languages create a .tmf, and how fast?".
  { id: "tmf-container", dir: "tmf-container" },
  // ── Native framework vs middleware — Galerina App Kernel's fixed 12-gate pipeline ──
  // The Node.js column IS the Galerina App Kernel (no middleware chain); python.py is an
  // equivalent SYNC gate chain (the "middleware" approach) doing the SAME gates. In-process
  // (no sockets) so it measures pipeline cost, not socket RTT. Unit = requests/sec.
  { id: "framework-pipeline", dir: "framework-pipeline" },
  // ── HTTP throughput — sequential requests/sec to governed localhost endpoint ──
  { id: "http-throughput", dir: "http-throughput", devtoolsOnly: true },
  // ── DevTools benchmarks — measure tool throughput over auth-service corpus ──
  // These run node.mjs only (no .spore / Rust / WASM path). Key metric: files/sec
  // or queries/sec. Added 2026-06-03 with the 4 new devtools packages.
  { id: "naming-check",       dir: "naming-check",       devtoolsOnly: true },
  { id: "context-receipt",    dir: "context-receipt",    devtoolsOnly: true },
  { id: "intelligence-search",dir: "intelligence-search", devtoolsOnly: true },
  { id: "provenance-trace",   dir: "provenance-trace",   devtoolsOnly: true },
];

// Resolve a usable Deno executable path on this machine.
// Windows-safe: prefer a real .exe path (cmd.exe under shell:true cannot run the
// POSIX-style path that Git's `which` returns, e.g. /c/Users/.../deno).
function resolveDenoBin() {
  const isWin = process.platform === "win32";
  const home  = process.env.USERPROFILE || process.env.HOME || "";
  // 1) Known default install location.
  const candidates = [
    join(home, ".deno", "bin", isWin ? "deno.exe" : "deno"),
  ];
  for (const c of candidates) { if (c && existsSync(c)) return c; }
  // 2) `where deno` (Windows) returns real, runnable paths; take the first .exe.
  try {
    const cmd = isWin ? "where deno" : "command -v deno";
    const out = execSync(cmd, { encoding: "utf8" }).trim().split(/\r?\n/);
    const pick = out.find(p => !isWin || /\.exe$/i.test(p)) || out[0];
    if (pick && existsSync(pick)) return pick;
  } catch { /* fall through */ }
  // 3) Last resort: bare name, let the shell resolve it.
  return "deno";
}

function runProc(cmd, args=[]) {
  // --expose-gc lets node runners force a clean GC baseline before measuring heap
  // delta, so the per-operation memory numbers are reliable (not GC-timing noise).
  const finalArgs = cmd === "node" ? ["--expose-gc", ...args] : args;
  const r = spawnSync(cmd, finalArgs, { encoding:"utf8", timeout:180000 });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try { return JSON.parse(r.stdout.trim()); } catch { return null; }
}

async function runGalerina(sporePath, mode, bench) {
  try {
    const { runGalerinaBenchmark, runGalerinaPassiveBenchmark } = await import("./galerina-runner.mjs");
    if (mode === "passive") {
      const callCount = bench?.passiveCallCount ?? 10;
      return await runGalerinaPassiveBenchmark(sporePath, callCount);
    }
    return await runGalerinaBenchmark(sporePath, mode);
  } catch(e) { return { error: true, reason: String(e), runtime: `galerina-${mode}` }; }
}

async function runBenchmark(bench) {
  const dir = join(benchDir, bench.dir);
  const res = {};

  // time-based benchmarks get --target-ms flag to override defaults in quick mode
  const timeBased  = bench.timeBased === true;
  const targetArgs = timeBased && QUICK_MODE ? ["--target-ms", "3000", "--warmup-ms", "500"] : [];

  const node = join(dir, "node.mjs");
  if (existsSync(node)) { console.log(`  node...`); res.nodejs = runProc("node", [node, ...targetArgs]); }

  const py = join(dir, "python.py");
  if (existsSync(py)) { console.log(`  python...`); res.python = runProc("python3",[py, ...targetArgs]) ?? runProc("python",[py, ...targetArgs]); }

  // ── Native hardware variants ─────────────────────────────────────────────
  // Naming convention:
  //   bench-native-rust        — generic x86-64 (safe, runs everywhere)
  //   bench-native-avx2        — AVX2 optimised (i5+, 256-bit SIMD)
  //   bench-native-avx512      — AVX-512 optimised (i9 HX/K only)
  //   bench-compute-mix-rust   — legacy name (kept for backwards compat)
  //   bench-arithmetic-rust    — legacy name
  //   bench-guess-rust         — legacy name
  for (const [key, suffixes] of [
    ["cpp",       ["bench-compute-mix","bench-arithmetic","bench-guess"]],
    ["rust",      ["bench-native-rust","bench-compute-mix-rust","bench-arithmetic-rust","bench-guess-rust"]],
    ["rustAvx2",  ["bench-native-avx2"]],
    ["rustAvx512",["bench-native-avx512"]],  // only populated on i9 machines
  ]) {
    for (const suf of suffixes) {
      const bin = join(dir, suf); const binE = bin + ".exe";
      const exe = existsSync(bin)?bin:existsSync(binE)?binE:null;
      if (exe) { console.log(`  ${key}...`); res[key] = runProc(exe); break; }
    }
  }

  // ── WASM execution (Phase 27 — requires wat-wasm assembler) ─────────────
  const wasmRunner = join(dir, "bench-wasm.mjs");
  if (existsSync(wasmRunner)) {
    console.log(`  wasm...`);
    try { res.wasm = await (await import(pathToFileURL(wasmRunner).href)).runWasmBenchmark(); }
    catch(e) { res.wasm = { error: true, reason: String(e), runtime: "wasm" }; }
  }

  // ── Deno WebGPU execution (Phase 38 — real GPU when Deno+WebGPU available) ─
  const denoWebGpuRunner = join(dir, "bench-deno-webgpu.ts");
  if (existsSync(denoWebGpuRunner)) {
    console.log(`  deno-webgpu...`);
    try {
      const { spawnSync: _sp } = await import("node:child_process");
      const denoBin = resolveDenoBin();
      // Quote the executable path (it may contain spaces / be a full path) for shell:true.
      const dr = _sp(`"${denoBin}"`, ["run", "--unstable-webgpu", `"${denoWebGpuRunner}"`], {
        encoding: "utf8", timeout: 60000, shell: true,
      });
      res.denoWebGpu = (dr.status === 0 && dr.stdout?.trim())
        ? (() => { try { return JSON.parse(dr.stdout.trim()); } catch { return null; } })()
        : { error: true, reason: dr.stderr?.slice(0,200) ?? "spawn failed", runtime: "deno-webgpu" };
    } catch(e) { res.denoWebGpu = { error: true, reason: String(e), runtime: "deno-webgpu" }; }
  }

  const spore = join(dir, "benchmark.spore");
  if (existsSync(spore)) {
    console.log(`  galerina (governed)...`);
    res.galerinaGoverned = await runGalerina(spore, "governed", bench);
    console.log(`  galerina (manifest)...`);
    res.galerinaManifest = await runGalerina(spore, "manifest", bench);
    console.log(`  galerina (passive)...`);
    res.galerinaPassive = await runGalerina(spore, "passive", bench);
  }

  // ── Normalise throughput to a single canonical unit per benchmark ──────────
  // throughput-units.mjs is the source of truth: it converts EVERY runtime to
  // inner-ops/sec so compare.mjs no longer pits Galerina's inner-ops/sec against
  // the other languages' whole-call/sec (the false-"Galerina wins" bug).
  const spec = benchmarkSpec(bench.id);
  let units;
  if (spec) {
    for (const key of Object.keys(res)) {
      const r = res[key];
      if (!r || typeof r !== "object") continue;
      const n = normalizeThroughput(key, r, bench.id);
      if (!n.speced) continue;
      r.normThroughput = n.ops;            // inner-ops/sec, or null (excluded / no data)
      r.throughputUnit = n.unit;
      if (!n.comparable && n.raw != null) r.rawThroughput = n.raw;  // display-only
    }
    units = assertBenchmarkUnits(bench.id, res);
  } else {
    // Out-of-scope benchmarks (galerinaOpsPerRun null/1) keep the legacy Galerina
    // normalisation: ops/sec = opsPerRun × runsPerSec, or result.value as the op count.
    for (const key of ["galerinaGoverned", "galerinaManifest"]) {
      const r = res[key];
      if (!r || r.error) continue;
      const resultValue = r.result?.__tag === "int" ? r.result.value : null;
      const opsPerRun   = bench.galerinaOpsPerRun ?? resultValue ?? null;
      if (opsPerRun !== null && r.execMs > 0) {
        r.galerinaOpsPerSecond = Math.round((opsPerRun / r.execMs) * 1000);
        r.galerinaOpsPerRun    = opsPerRun;
      }
    }
  }

  return { benchmark: bench.id, results: res, ...(units ? { units } : {}) };
}

// --quick: use 3s for time-based benchmarks (compute-mix), halve iteration counts.
// Good for CI and development feedback. Use without --quick for publication numbers.
export const QUICK_MODE = process.argv.includes("--quick");

async function main() {
  const filterIdx = process.argv.indexOf("--benchmark");
  const filter    = filterIdx >= 0 ? process.argv[filterIdx+1] : null;
  const toRun     = filter ? BENCHMARKS.filter(b=>b.id===filter) : BENCHMARKS;
  if (QUICK_MODE) console.log("⚡ Quick mode: 3s compute-mix, reduced iteration counts");
  const all       = [];

  for (const b of toRun) {
    console.log(`\n=== ${b.id} ===`);
    const r = await runBenchmark(b);
    all.push(r);
    console.log(JSON.stringify(r, null, 2));
  }

  const outPath = join(resultsDir, "latest.json");
  writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`\nResults: ${outPath}`);

  // ── Unit-alignment assertion ───────────────────────────────────────────────
  // Every comparable benchmark must report ONE unit across all runtimes; the three
  // non-comparable benchmarks are expected to be FLAGGED (excluded). A FAIL means a
  // unit mismatch or a silent dropout slipped back in — fail the run so CI catches it.
  const checks = all.map(b => b.units).filter(Boolean);
  if (checks.length) {
    console.log("\n── Unit-alignment check ─────────────────────────────────");
    let failed = 0;
    for (const c of checks) {
      const icon = c.status === "PASS" ? "✅" : c.status === "FLAGGED" ? "⚠️ " : "❌";
      console.log(`  ${icon} ${c.benchId.padEnd(20)} ${c.status.padEnd(8)} unit=${c.unit}`);
      if (c.status === "FLAGGED") console.log(`        excluded: ${c.reason}`);
      for (const p of c.problems ?? []) { console.log(`        ↳ ${p}`); failed++; }
    }
    if (failed > 0) {
      console.error(`\n  ❌ ${failed} unit-alignment problem(s) — see ↳ lines above.`);
      process.exitCode = 1;
    } else {
      console.log("\n  ✅ All comparable benchmarks report a single, matching unit.");
    }
  }

  // ── Diagnostic Benchmark Suite ────────────────────────────────────────────
  // Only run when --diagnostic flag is passed, or always if --benchmark diagnostic
  if (process.argv.includes("--diagnostic") || filter === "diagnostic") {
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  Diagnostic Benchmarks — Governance Fidelity");
    console.log("═══════════════════════════════════════════════════");
    const { runDiagnosticBenchmarks } = await import(
      "../benchmarks/diagnostic/bench-diagnostic.mjs"
    );
    const diagResults = await runDiagnosticBenchmarks();

    // Print results
    for (const t of diagResults.tests) {
      if (t.category === "logging-throughput") {
        const tax = t.auditTaxPercent;
        console.log(`  [AUDIT TAX] ${t.test}`);
        console.log(`             pure:${t.pureFlowMsPerOp}ms  secure:${t.secureFlowMsPerOp}ms  tax:${tax}%`);
      } else {
        const icon = t.governancePass ? "OK" : "FAIL";
        const traps = t.trapDeclarationsFound !== undefined ? `  traps:${t.trapDeclarationsFound}` : "";
        const ensures = t.invariantClausesFound !== undefined ? `  ensures:${t.invariantClausesFound}` : "";
        console.log(`  [${icon}] ${t.test}${traps}${ensures}  ${t.msPerOp}ms/op`);
      }
    }

    const s = diagResults.summary;
    const compliant = s.governanceCompliant ? "PASS" : "FAIL";
    console.log(`\n  Governance Fidelity:  ${compliant} (all 5 flows)`);
    console.log(`  Total trap decls:     ${s.totalTrapDeclarationsAcrossSuite} across suite`);
    console.log(`  Audit Tax (Stage A):  ${s.auditTaxPercent}% (gov-check variance)`);
    console.log(`  Stage B target:       ${s.stageBTarget}`);

    // Save diagnostic results
    const diagPath = join(resultsDir, "diagnostic-latest.json");
    writeFileSync(diagPath, JSON.stringify(diagResults, null, 2));
    console.log(`\n  Results: ${diagPath}`);
  }
}

main().catch(e => { console.error(e); process.exitCode=1; });
