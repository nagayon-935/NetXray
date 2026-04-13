import { NetXrayIR } from "../types/netxray-ir";

export interface JsonPatchOperation {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: any;
}

/**
 * Apply a list of JSON Patch operations to an IR object.
 * Returns a new object (immutable update).
 */
export function applyPatch(ir: NetXrayIR, patches: JsonPatchOperation[]): NetXrayIR {
  const newIr = JSON.parse(JSON.stringify(ir)) as NetXrayIR;

  for (const patch of patches) {
    const parts = patch.path.split('/').filter(p => p !== '');
    let current: any = newIr;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined) {
          // If the path doesn't exist, we skip or could optionally create it.
          // For telemetry updates, we expect the path to exist.
          break;
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (patch.op === 'replace' || patch.op === 'add') {
      current[lastPart] = patch.value;
    } else if (patch.op === 'remove') {
      delete current[lastPart];
    }
  }

  return newIr;
}
