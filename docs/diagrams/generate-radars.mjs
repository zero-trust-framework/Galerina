// generate-radars.mjs — produces 3 radar charts comparing LogicN to mainstream languages across
// three categories. Run: `node docs/diagrams/generate-radars.mjs`. Scores are 0–10, honest/defensible
// (see README "honest scope"). Short axis labels by design.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = dirname(fileURLToPath(import.meta.url));

const SERIES_COLORS = {
  LogicN: "#e8590c",   // signature orange
  Rust:   "#b7410e",
  Go:     "#00add8",
  "C++":  "#6f42c1",
  Python: "#3572a5",
  Zig:    "#f7a41d",
  Node:   "#43853d",
};

const charts = [
  {
    file: "radar-1-security-governance.svg",
    title: "1 · Security & Governance",
    subtitle: "where LogicN is built to lead",
    axes: ["Fail-closed Auth", "Memory Safe", "Capability Ctrl", "Audit / Provenance", "Supply-chain", "Data Privacy"],
    series: {
      LogicN: [10, 9, 10, 10, 9, 9],
      Rust:   [3, 10, 4, 2, 5, 2],
      Go:     [3, 8, 2, 2, 5, 2],
      "C++":  [2, 3, 2, 1, 2, 1],
    },
  },
  {
    file: "radar-2-performance-systems.svg",
    title: "2 · Raw Performance & Systems",
    subtitle: "where LogicN trades speed for safety",
    axes: ["Single-thread Speed", "Low-level Ctrl", "Startup", "Concurrency", "Mem Footprint", "Latency Predict."],
    series: {
      LogicN: [5, 2, 8, 5, 5, 6],
      Rust:   [10, 9, 9, 9, 9, 10],
      "C++":  [10, 10, 9, 7, 9, 10],
      Go:     [7, 4, 8, 10, 6, 5],
    },
  },
  {
    file: "radar-3-devx-ecosystem.svg",
    title: "3 · Developer Experience & Ecosystem",
    subtitle: "LogicN is new — strong on safety, thin on maturity",
    axes: ["Easy to Learn", "Tooling", "Ecosystem", "Type Safety", "Iteration", "Maturity / Hiring"],
    series: {
      LogicN: [5, 6, 2, 9, 6, 2],
      Python: [9, 7, 10, 3, 9, 10],
      Go:     [8, 9, 7, 7, 8, 9],
      Rust:   [3, 9, 7, 10, 5, 7],
    },
  },
  {
    // The "we play a different game" chart: capabilities that are NATIVE to a ternary multi-substrate
    // orchestrator and ABSENT (or hand-rolled, ungoverned) in binary languages. LogicN's primitives here
    // already ship (resilience{}/fallback_digital, vAndTensor=Tensorized No-Coercion, K3 vAnd=min,
    // freivalds verify-cheap + ToleranceWitness). Others score low because they don't ATTEMPT this natively.
    file: "radar-4-governed-chaos.svg",
    title: "4 · Governed Chaos & Multi-Substrate",
    subtitle: "the category binary languages don't play in",
    axes: ["Substrate Switch", "Fault Healing", "AI-Proposal Safety", "Tri-logic Ambiguity", "Verified Approx.", "Degrade-only"],
    series: {
      LogicN: [9, 7, 9, 10, 8, 9],
      Python: [1, 2, 1, 1, 2, 1],
      Rust:   [1, 3, 1, 1, 2, 2],
      "C++":  [1, 2, 1, 1, 2, 1],
    },
  },
];

const W = 720, H = 560, CX = 300, CY = 300, R = 210, MAXV = 10, RINGS = 5;
const TAU = Math.PI * 2;
const angleFor = (i, n) => -Math.PI / 2 + (i / n) * TAU;            // start at top, clockwise
const pt = (i, n, v) => {
  const a = angleFor(i, n), r = (v / MAXV) * R;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};
const fmt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
// Escape XML-special chars in text content. A raw `&` (e.g. "Security & Governance") makes the SVG invalid
// XML and renders as an error — the bug this fixes. (`<`/`>` escaped too for safety.)
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg(chart) {
  const n = chart.axes.length;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,Segoe UI,Roboto,sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${CX}" y="34" text-anchor="middle" font-size="22" font-weight="700" fill="#1a1a1a">${esc(chart.title)}</text>`);
  parts.push(`<text x="${CX}" y="56" text-anchor="middle" font-size="13" fill="#666">${esc(chart.subtitle)}</text>`);

  // concentric grid rings
  for (let ring = 1; ring <= RINGS; ring++) {
    const poly = [];
    for (let i = 0; i < n; i++) poly.push(fmt(pt(i, n, (ring / RINGS) * MAXV)));
    parts.push(`<polygon points="${poly.join(" ")}" fill="none" stroke="#e3e3e3" stroke-width="1"/>`);
  }
  // axes + labels
  for (let i = 0; i < n; i++) {
    const [ex, ey] = pt(i, n, MAXV);
    parts.push(`<line x1="${CX}" y1="${CY}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#d0d0d0" stroke-width="1"/>`);
    const a = angleFor(i, n);
    const lx = CX + (R + 18) * Math.cos(a), ly = CY + (R + 18) * Math.sin(a);
    const cos = Math.cos(a);
    const anchor = cos > 0.25 ? "start" : cos < -0.25 ? "end" : "middle";
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="12.5" font-weight="600" fill="#333">${esc(chart.axes[i])}</text>`);
  }
  // data polygons
  const names = Object.keys(chart.series);
  names.forEach((name) => {
    const vals = chart.series[name];
    const poly = vals.map((v, i) => fmt(pt(i, n, v))).join(" ");
    const c = SERIES_COLORS[name] ?? "#888";
    parts.push(`<polygon points="${poly}" fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`);
    vals.forEach((v, i) => { const [x, y] = pt(i, n, v); parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${c}"/>`); });
  });
  // legend
  let ly = 120;
  parts.push(`<text x="600" y="${ly - 22}" text-anchor="middle" font-size="12" font-weight="700" fill="#888">LEGEND</text>`);
  names.forEach((name) => {
    const c = SERIES_COLORS[name] ?? "#888";
    parts.push(`<rect x="556" y="${ly - 10}" width="16" height="6" rx="2" fill="${c}"/>`);
    parts.push(`<text x="578" y="${ly - 4}" font-size="13" font-weight="${name === "LogicN" ? 700 : 500}" fill="#1a1a1a">${esc(name)}</text>`);
    ly += 24;
  });
  parts.push(`<text x="${CX}" y="${H - 14}" text-anchor="middle" font-size="11" fill="#aaa">0 (center) → 10 (edge) · LogicN vs mainstream languages</text>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

for (const c of charts) {
  writeFileSync(join(OUT, c.file), svg(c));
  console.log("wrote", c.file);
}
