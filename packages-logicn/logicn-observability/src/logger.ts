// =============================================================================
// Structured app logs — leveled, structured (JSON-shaped) records emitted to a
// pluggable sink. PURE of ambient authority by default: the DEFAULT sink is
// in-memory (no stdout, no files, no network), and the clock is injectable. A host
// that wants console/file/network output opts INTO a sink explicitly — the library
// never grabs an output channel on its own.
//
// FAIL-CLOSED, the observability sense: logging must NEVER break the caller. A sink
// that throws is swallowed (and counted); a record whose fields cannot be serialised
// degrades to a safe marker rather than throwing. You can always log; logging can
// never take down the request path.
//
// REDACTION: field keys that look sensitive (password, token, secret, authorization,
// …) are replaced with "[redacted]" before they reach any sink — defence in depth so
// an app log line cannot accidentally egress a credential.
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One structured log record. `fields` is already redacted by the time it reaches a sink. */
export interface LogRecord {
  readonly level: LogLevel;
  readonly msg: string;
  /** ms since epoch (from the injected clock). */
  readonly at: number;
  readonly logger?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** A log destination. `write` MUST NOT throw; if it does, the logger isolates the fault. */
export interface LogSink {
  write(record: LogRecord): void;
}

/** Default sink: keep records in memory. No I/O, no ambient authority. Ideal for tests + embedding. */
export class MemoryLogSink implements LogSink {
  readonly #records: LogRecord[] = [];
  write(record: LogRecord): void {
    this.#records.push(record);
  }
  records(): readonly LogRecord[] {
    return this.#records;
  }
  clear(): void {
    this.#records.length = 0;
  }
}

/**
 * Opt-in sink that serialises each record to one JSON line on a caller-supplied writer
 * (e.g. a bound `process.stdout.write`). The host chooses to grant the output channel —
 * the library does not reach for `console`/`process` itself (zero ambient authority).
 */
export class JsonLineSink implements LogSink {
  readonly #writeLine: (line: string) => void;
  constructor(writeLine: (line: string) => void) {
    this.#writeLine = writeLine;
  }
  write(record: LogRecord): void {
    this.#writeLine(safeStringify(record));
  }
}

/** Default set of field keys (case-insensitive) whose VALUES are redacted before logging. */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "password", "passwd", "pwd", "secret", "token", "accesstoken", "refreshtoken",
  "authorization", "apikey", "api_key", "privatekey", "private_key", "cookie",
  "sessionid", "session_id", "ssn", "creditcard", "card_number", "cvv",
];

const REDACTED = "[redacted]";

export interface LoggerOptions {
  /** Destination for records. Default: a fresh in-memory sink (no I/O). */
  readonly sink?: LogSink;
  /** Drop records below this level. Default "info". */
  readonly minLevel?: LogLevel;
  /** Logger name, attached to every record. */
  readonly name?: string;
  /** Fields merged into every record (e.g. `{ service: "orders" }`). */
  readonly baseFields?: Readonly<Record<string, unknown>>;
  /** Field keys to redact (case-insensitive). Default DEFAULT_REDACT_KEYS. */
  readonly redactKeys?: readonly string[];
  /** Injectable clock (ms). Default Date.now. Override for deterministic tests. */
  readonly clock?: () => number;
}

/**
 * Structured, leveled logger. Build one with `createLogger()`; derive scoped children
 * with `.child()`. Every emission is fail-closed: a throwing sink or unserialisable
 * field can never propagate to the caller.
 */
export class Logger {
  readonly #sink: LogSink;
  readonly #minLevel: number;
  readonly #name: string | undefined;
  readonly #baseFields: Readonly<Record<string, unknown>>;
  readonly #redact: ReadonlySet<string>;
  readonly #clock: () => number;
  #sinkFailures = 0;

  constructor(opts: LoggerOptions = {}) {
    this.#sink = opts.sink ?? new MemoryLogSink();
    this.#minLevel = LEVEL_ORDER[opts.minLevel ?? "info"];
    this.#name = opts.name;
    this.#baseFields = opts.baseFields ?? {};
    this.#redact = new Set((opts.redactKeys ?? DEFAULT_REDACT_KEYS).map((k) => k.toLowerCase()));
    this.#clock = opts.clock ?? (() => Date.now());
  }

  debug(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.#emit("debug", msg, fields);
  }
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.#emit("info", msg, fields);
  }
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.#emit("warn", msg, fields);
  }
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.#emit("error", msg, fields);
  }

  /** Derive a child logger that shares the sink/clock but extends name + base fields. */
  child(name: string, fields?: Readonly<Record<string, unknown>>): Logger {
    const childName = this.#name ? `${this.#name}.${name}` : name;
    return new Logger({
      sink: this.#sink,
      minLevel: levelName(this.#minLevel),
      name: childName,
      baseFields: { ...this.#baseFields, ...(fields ?? {}) },
      redactKeys: Array.from(this.#redact),
      clock: this.#clock,
    });
  }

  /** Count of sink writes that threw and were isolated. Lets a host observe its own logging health. */
  sinkFailures(): number {
    return this.#sinkFailures;
  }

  #emit(level: LogLevel, msg: string, fields?: Readonly<Record<string, unknown>>): void {
    try {
      if (LEVEL_ORDER[level] < this.#minLevel) return;
      const merged = { ...this.#baseFields, ...(fields ?? {}) };
      const redacted = this.#redactFields(merged);
      const record: LogRecord = {
        level,
        msg: typeof msg === "string" ? msg : String(msg),
        at: this.#safeNow(),
        ...(this.#name !== undefined ? { logger: this.#name } : {}),
        ...(Object.keys(redacted).length > 0 ? { fields: redacted } : {}),
      };
      try {
        this.#sink.write(record);
      } catch {
        // A faulty sink must never break the caller. Count it; carry on.
        this.#sinkFailures += 1;
      }
    } catch {
      // Even record construction is wrapped: logging can never throw into the request path.
      this.#sinkFailures += 1;
    }
  }

  #safeNow(): number {
    try {
      const n = this.#clock();
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  #redactFields(fields: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) {
      out[key] = this.#redact.has(key.toLowerCase()) ? REDACTED : fields[key];
    }
    return out;
  }
}

function levelName(order: number): LogLevel {
  for (const [name, n] of Object.entries(LEVEL_ORDER)) {
    if (n === order) return name as LogLevel;
  }
  return "info";
}

/** Serialise a record to JSON, degrading unserialisable content to a safe marker (never throws). */
export function safeStringify(record: LogRecord): string {
  try {
    return JSON.stringify(record);
  } catch {
    // Circular or otherwise unserialisable fields: emit the record without them.
    try {
      const safe: LogRecord = {
        level: record.level,
        msg: record.msg,
        at: record.at,
        ...(record.logger !== undefined ? { logger: record.logger } : {}),
        fields: { _note: "fields omitted: not serialisable" },
      };
      return JSON.stringify(safe);
    } catch {
      return '{"level":"error","msg":"log record not serialisable","at":0}';
    }
  }
}

/** Build a structured logger. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return new Logger(opts);
}
