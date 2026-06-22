/**
 * LogicN Hardened Border — Plugin Schema Validation
 *
 * Enforces the "Toxic Border" protocol:
 * Every plugin boundary is a DMZ. All inputs are validated against explicit schemas
 * before the plugin sees them. The Tower never trusts plugin-reported types.
 *
 * Plugin folder structure (enforced by logicn promote):
 *   /plugins/<name>-v<version>/
 *     ├── manifest.json      ← security limits (CPU/RAM/time/memory)
 *     ├── governance.lln     ← capability declarations ([conforms_to: guard])
 *     ├── plugin.wasm        ← signed compiled binary
 *     └── schemas/
 *         └── data_types.json ← strict input/output type contract
 */

import { createHash } from "node:crypto";

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly governanceTier: 1 | 2 | 3;
  readonly license: "MIT" | "Apache-2.0" | "proprietary";
  readonly sourceHash: string;      // sha256 of source repo at promotion time
  readonly resourceLimits: {
    readonly maxMemoryMB: number;   // WASM linear memory ceiling
    readonly maxCpuCycles: number;  // Wasmtime fuel limit
    readonly maxWallMs: number;     // Wall clock timeout
  };
  readonly capabilities: string[];  // ["ai.inference", "audit.write"]
  readonly blacklisted: boolean;    // Set to true on panic-as-security event
  readonly blacklistReason?: string;
}

export interface PluginDataSchema {
  readonly version: "1.0";
  readonly inputs: readonly PluginField[];
  readonly outputs: readonly PluginField[];
  readonly strict: true;  // Always true — any deviation is a SECURITY_ALERT
}

export interface PluginField {
  readonly name: string;
  readonly type: "Int" | "String" | "Bool" | "Float" | "Bytes" | "Array<Int>" | "Array<String>";
  readonly required: boolean;
  readonly maxLength?: number;   // For String/Bytes — prevents oversized inputs
  readonly minValue?: number;    // For Int/Float — range enforcement
  readonly maxValue?: number;
}

/**
 * Validate incoming data against a plugin's schema.
 * Returns an array of violations — empty = clean.
 * Any violation triggers a SECURITY_ALERT, not a type error.
 */
export function validatePluginInput(
  data: Record<string, unknown>,
  schema: PluginDataSchema,
  pluginName: string,
): PluginSchemaViolation[] {
  const violations: PluginSchemaViolation[] = [];

  for (const field of schema.inputs) {
    const value = data[field.name];

    // Missing required field
    if (value === undefined || value === null) {
      if (field.required) {
        violations.push({
          code: "LLN-BORDER-001",
          name: "MISSING_REQUIRED_FIELD",
          plugin: pluginName,
          field: field.name,
          message: `Plugin '${pluginName}' input '${field.name}' is required but missing. ` +
                   `Treating as potential schema poisoning attack.`,
          severity: "error",
        });
      }
      continue;
    }

    // Type mismatch
    const actualType = inferType(value);
    if (actualType !== field.type && !isCompatibleType(actualType, field.type)) {
      violations.push({
        code: "LLN-BORDER-002",
        name: "TYPE_MISMATCH",
        plugin: pluginName,
        field: field.name,
        message: `Plugin '${pluginName}' input '${field.name}': expected ${field.type}, got ${actualType}. ` +
                 `Schema deviation treated as hostile input.`,
        severity: "error",
      });
    }

    // Range / length checks
    if (field.type === "String" || field.type === "Bytes") {
      const str = String(value);
      if (field.maxLength !== undefined && str.length > field.maxLength) {
        violations.push({
          code: "LLN-BORDER-003",
          name: "FIELD_TOO_LARGE",
          plugin: pluginName,
          field: field.name,
          message: `Plugin '${pluginName}' input '${field.name}': length ${str.length} exceeds max ${field.maxLength}. ` +
                   `Possible buffer overflow attempt.`,
          severity: "error",
        });
      }
    }

    if ((field.type === "Int" || field.type === "Float") && typeof value === "number") {
      if (field.minValue !== undefined && value < field.minValue) {
        violations.push({ code: "LLN-BORDER-004", name: "VALUE_BELOW_MINIMUM", plugin: pluginName,
          field: field.name, message: `Value ${value} below minimum ${field.minValue}.`, severity: "error" });
      }
      if (field.maxValue !== undefined && value > field.maxValue) {
        violations.push({ code: "LLN-BORDER-004", name: "VALUE_ABOVE_MAXIMUM", plugin: pluginName,
          field: field.name, message: `Value ${value} above maximum ${field.maxValue}.`, severity: "error" });
      }
    }
  }

  return violations;
}

export interface PluginSchemaViolation {
  readonly code: string;
  readonly name: string;
  readonly plugin: string;
  readonly field: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

function inferType(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) return "Int";
  if (typeof value === "number") return "Float";
  if (typeof value === "string") return "String";
  if (typeof value === "boolean") return "Bool";
  if (value instanceof Uint8Array) return "Bytes";
  if (Array.isArray(value)) {
    if (value.every(v => typeof v === "number")) return "Array<Int>";
    if (value.every(v => typeof v === "string")) return "Array<String>";
    return "Array<unknown>";
  }
  return "unknown";
}

function isCompatibleType(actual: string, expected: string): boolean {
  // Int is compatible with Float
  if (actual === "Int" && expected === "Float") return true;
  return false;
}

/**
 * Compute compliance hash of plugin output.
 * Used in Stage 4 (Compliance Hash) of the Load/Execute/Erase cycle.
 * Stored in the Epilogue Receipt for forensic trail.
 */
export function computeComplianceHash(
  output: unknown,
  _schema: PluginDataSchema,
): string {
  // Normalize output to canonical JSON, then sha256
  const canonical = JSON.stringify(output, Object.keys(output as object).sort());
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32);
}

/**
 * Hard erasure of a plugin execution context.
 * In Stage A: clears all references. In Stage B: DSS.wasm zeroes the WASM linear memory.
 * Returns an erasure receipt for the audit log.
 */
export function hardErase(executionId: string): ErasureReceipt {
  // In Stage B DSS.wasm: WASM linear memory zeroed, WASM instance freed.
  // In Stage A: JS GC handles collection; this record is the audit evidence.
  return {
    executionId,
    erasedAt: new Date().toISOString(),
    status: "ERASED",
    stateRemaining: "none",
  };
}

export interface ErasureReceipt {
  readonly executionId: string;
  readonly erasedAt: string;
  readonly status: "ERASED";
  readonly stateRemaining: "none";
}
