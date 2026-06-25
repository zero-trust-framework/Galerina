// One-off: rank each benchmark's runtimes by throughput → winner / runner-up / LogicN rank.
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(new URL("./results/latest.json", import.meta.url)));
const arr = Object.values(r);
const perSec = (o) => {
  if (!o || typeof o !== "object") return null;
  for (const k of Object.keys(o)) if (k.toLowerCase().endsWith("persecond") && typeof o[k] === "number") return o[k];
  return null;
};
const fmt = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "k" : v.toFixed(0);
console.log("BENCH | WINNER | RUNNER-UP | LOGICN_RANK | all(desc)");
for (const e of arr) {
  const b = e.benchmark;
  const res = e.results || {};
  let rows = Object.entries(res).map(([rt, o]) => [rt, perSec(o)]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
  if (!rows.length) continue;
  const li = rows.findIndex(([rt]) => /logicn/i.test(rt));
  const lr = li >= 0 ? (li + 1) + "/" + rows.length : "—";
  console.log(b + " | " + rows[0][0] + " (" + fmt(rows[0][1]) + ") | " + (rows[1] ? rows[1][0] + " (" + fmt(rows[1][1]) + ")" : "—") + " | " + lr + " | " + rows.map(([rt, v]) => rt + ":" + fmt(v)).join("  "));
}
