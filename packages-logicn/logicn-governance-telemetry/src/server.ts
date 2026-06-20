// =============================================================================
// The exporter HTTP shell — serves /metrics (+ /healthz, /readyz) on the METRICS port
// (default 9090, isolated from the app's ingress so saturating ingress can't kill telemetry).
// Read-only. The body is always produced by the fenced `renderPrometheus`. R&D 0050.
//
// node:http is loaded WITHOUT @types/node (this package ships none) via a dynamically-typed
// import + the minimal duck-typed slice we use, mirroring logicn-framework-app-kernel.
// =============================================================================
import { renderPrometheus, type GovernanceSnapshot } from "./exposition.js";

interface IncomingMessage {
  url?: string;
  method?: string;
}
interface ServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}
interface HttpServer {
  listen(port: number, cb?: () => void): HttpServer;
  close(cb?: () => void): void;
}
interface NodeHttp {
  createServer(listener: (req: IncomingMessage, res: ServerResponse) => void): HttpServer;
}

const dynImport = (s: string): Promise<unknown> =>
  (Function("s", "return import(s)") as (s: string) => Promise<unknown>)(s);

export interface ExporterOptions {
  /** Metrics port (default 9090). Kept separate from the app's ingress listener. */
  readonly port?: number;
  /** Produces the current structural snapshot to render. Called per scrape. */
  readonly snapshot: () => GovernanceSnapshot;
  /** Readiness: when it returns false, /readyz answers 503 so K8s sheds load at the pod level. */
  readonly ready?: () => boolean;
}

export interface ExporterHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Start the read-only governance-telemetry exporter. Serves:
 *   GET /metrics  → fenced Prometheus exposition (text/plain; version=0.0.4)
 *   GET /healthz  → 200 (liveness; reads no governed state)
 *   GET /readyz   → 200 / 503 from `ready()` (pod-level load shedding)
 * Non-GET → 405. Any render error → 500 (fail-closed: never serve partial/unfenced output).
 */
export async function startExporter(opts: ExporterOptions): Promise<ExporterHandle> {
  const http = (await dynImport("node:http")) as NodeHttp;
  const port = opts.port ?? 9090;
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if ((req.method ?? "GET") !== "GET") {
      res.statusCode = 405;
      res.end("method not allowed\n");
      return;
    }
    try {
      if (path === "/metrics") {
        const body = renderPrometheus(opts.snapshot());
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(body);
      } else if (path === "/healthz") {
        res.statusCode = 200;
        res.end("ok\n");
      } else if (path === "/readyz") {
        const ready = opts.ready ? opts.ready() : true;
        res.statusCode = ready ? 200 : 503;
        res.end(ready ? "ready\n" : "not ready\n");
      } else {
        res.statusCode = 404;
        res.end("not found\n");
      }
    } catch {
      res.statusCode = 500; // fail-closed
      res.end("error\n");
    }
  });
  await new Promise<void>((resolve) => server.listen(port, () => resolve()));
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
