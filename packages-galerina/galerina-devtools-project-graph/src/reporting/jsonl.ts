// =============================================================================
// lln-graph — JsonlWriter
//
// Append-only JSONL writer for LogicN runtime audit events.
// Enforces the 7-rule contract from NOTES TO COVER / c:
//
//   1. Writer appends only.
//   2. Each event serializes to exactly one JSON line.
//   3. Each line ends with "\n".
//   4. Writer must reject invalid schemaVersion.
//   5. Writer must reject unsafe raw secrets.
//   6. Writer must not pretty-print JSONL.
//   7. Writer must preserve event order per writer instance.
// =============================================================================

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RuntimeAuditEvent } from "./event-dag.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class JsonlWriterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JsonlWriterError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Serializer (exported for testing)
// ---------------------------------------------------------------------------

const FORBIDDEN_SECRET_KEYS = [
  "secret",
  "password",
  "token",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
  "bearerToken",
  "bearer_token",
  "authHeader",
  "sessionCookie",
  "credential",
];

/**
 * Serialise a RuntimeAuditEvent to a JSONL line (no trailing whitespace,
 * ends with \n). Enforces rules 2, 3, 4, 5, 6.
 */
export function serializeAuditEvent(event: RuntimeAuditEvent): string {
  // Rule 4: reject invalid schemaVersion.
  if (event.schemaVersion !== "spore.runtime.audit.v1") {
    throw new JsonlWriterError(
      "SPORE-REPORT-001",
      `Invalid runtime audit schemaVersion "${event.schemaVersion}". Expected "spore.runtime.audit.v1".`,
    );
  }

  // Rule 5: reject events where metadata contains potential raw secrets.
  if (event.metadata !== undefined) {
    for (const key of Object.keys(event.metadata)) {
      if (FORBIDDEN_SECRET_KEYS.some((bad) => key.toLowerCase().includes(bad))) {
        throw new JsonlWriterError(
          "SPORE-AUDIT-003",
          `Audit event metadata contains a field "${key}" that may hold a raw secret. Redact before logging.`,
        );
      }
    }
  }

  // Rule 6: JSON.stringify produces compact JSON (no pretty-printing).
  // Rule 2+3: single line ending with \n.
  return JSON.stringify(event) + "\n";
}

// ---------------------------------------------------------------------------
// Writer interface
// ---------------------------------------------------------------------------

export interface JsonlWriter {
  /** Rule 1: append only. Rule 7: order preserved per instance. */
  append(event: RuntimeAuditEvent): Promise<void>;
  /** Flush any buffered writes (optional; no-op for unbuffered writers). */
  flush?(): Promise<void>;
  /** Close the writer. No further appends are permitted after close(). */
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// File-backed writer
// ---------------------------------------------------------------------------

/**
 * Create a file-backed JSONL writer.
 * The parent directory is created if it does not exist.
 * The file is opened in append mode; existing content is preserved.
 *
 * All appends are serialised through a promise chain (Rule 7).
 */
export function createJsonlWriter(filePath: string): JsonlWriter {
  let closed = false;
  // Serialise writes by chaining promises.
  let tail: Promise<void> = Promise.resolve();
  let dirReady: Promise<void> | undefined;

  function ensureDir(): Promise<void> {
    if (dirReady === undefined) {
      dirReady = mkdir(dirname(filePath), { recursive: true }).then(() => undefined);
    }
    return dirReady;
  }

  return {
    async append(event: RuntimeAuditEvent): Promise<void> {
      if (closed) {
        throw new JsonlWriterError(
          "SPORE-REPORT-005",
          "Cannot append to a closed JsonlWriter.",
        );
      }
      const line = serializeAuditEvent(event); // may throw — intentional
      tail = tail.then(() => ensureDir()).then(() => appendFile(filePath, line, "utf8"));
      await tail;
    },

    flush(): Promise<void> {
      return tail;
    },

    async close(): Promise<void> {
      await tail;
      closed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory writer (for testing / report generation)
// ---------------------------------------------------------------------------

export interface InMemoryJsonlWriter extends JsonlWriter {
  readonly lines: readonly string[];
  readonly events: readonly RuntimeAuditEvent[];
  toString(): string;
}

export function createInMemoryJsonlWriter(): InMemoryJsonlWriter {
  const lines: string[] = [];
  const events: RuntimeAuditEvent[] = [];
  let closed = false;

  return {
    get lines(): readonly string[] {
      return lines;
    },
    get events(): readonly RuntimeAuditEvent[] {
      return events;
    },
    toString(): string {
      return lines.join("");
    },
    async append(event: RuntimeAuditEvent): Promise<void> {
      if (closed) {
        throw new JsonlWriterError("SPORE-REPORT-005", "Cannot append to a closed JsonlWriter.");
      }
      const line = serializeAuditEvent(event);
      lines.push(line);
      events.push(event);
    },
    async flush(): Promise<void> {
      // no-op for in-memory writer
    },
    async close(): Promise<void> {
      closed = true;
    },
  };
}
