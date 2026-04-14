import type { NetXrayIR } from "../types/netxray-ir";

export interface JsonPatchOperation {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}

/**
 * Apply a list of JSON Patch (RFC 6902) operations to an IR object.
 * Returns a new object (immutable update via deep-clone).
 *
 * Extended syntax: a path segment starting with `~` is treated as a
 * node-ID lookup on arrays: `~spine1` finds the array element whose
 * `.id === "spine1"`.  This lets the backend stream patches without
 * knowing array indices, e.g.:
 *
 *   { "op": "replace",
 *     "path": "/topology/nodes/~spine1/interfaces/eth0/traffic_in_bps",
 *     "value": 123456 }
 */
export function applyPatch(ir: NetXrayIR, patches: JsonPatchOperation[]): NetXrayIR {
  const newIr = JSON.parse(JSON.stringify(ir)) as NetXrayIR;

  for (const patch of patches) {
    const parts = patch.path.split("/").filter((p) => p !== "");
    let current: unknown = newIr;
    let valid = true;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      if (Array.isArray(current)) {
        if (part.startsWith("~")) {
          // Extended: find array element by `id` field
          const targetId = part.slice(1);
          const idx = (current as Record<string, unknown>[]).findIndex(
            (item) => item?.id === targetId
          );
          if (idx === -1) {
            valid = false;
            break;
          }
          current = (current as unknown[])[idx];
        } else {
          // Standard: numeric index
          const idx = parseInt(part, 10);
          if (isNaN(idx)) {
            valid = false;
            break;
          }
          current = (current as unknown[])[idx];
        }
      } else if (current !== null && typeof current === "object") {
        const obj = current as Record<string, unknown>;
        if (obj[part] === undefined) {
          // For 'add' we can create intermediate objects; otherwise skip
          if (patch.op === "add") {
            obj[part] = {};
          } else {
            valid = false;
            break;
          }
        }
        current = obj[part];
      } else {
        valid = false;
        break;
      }
    }

    if (!valid) continue;

    const lastPart = parts[parts.length - 1];
    if (lastPart === undefined) continue;

    const target = current as Record<string, unknown>;
    if (patch.op === "replace" || patch.op === "add") {
      target[lastPart] = patch.value;
    } else if (patch.op === "remove") {
      delete target[lastPart];
    }
  }

  return newIr;
}
