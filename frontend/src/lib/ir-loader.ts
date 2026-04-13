import type { NetXrayIR } from "../types/netxray-ir";

const SUPPORTED_VERSIONS = ["0.1.0", "0.2.0", "0.3.0"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 15_000; // 15 seconds

type ValidateResult =
  | { valid: true; ir: NetXrayIR }
  | { valid: false; error: string };

export function validateIR(data: unknown): ValidateResult {
  if (typeof data !== "object" || data === null) {
    return { valid: false, error: "IR must be a JSON object" };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.ir_version !== "string") {
    return { valid: false, error: "Missing or invalid ir_version" };
  }

  if (!SUPPORTED_VERSIONS.includes(obj.ir_version)) {
    // Truncate user-controlled version string before reflecting it back
    const safe = String(obj.ir_version).slice(0, 50).replace(/[^\w.-]/g, "?");
    return {
      valid: false,
      error: `Unsupported IR version: "${safe}". Supported: ${SUPPORTED_VERSIONS.join(", ")}`,
    };
  }

  if (!obj.topology || typeof obj.topology !== "object") {
    return { valid: false, error: "Missing topology" };
  }

  const topo = obj.topology as Record<string, unknown>;
  if (!Array.isArray(topo.nodes)) {
    return { valid: false, error: "topology.nodes must be an array" };
  }
  if (!Array.isArray(topo.links)) {
    return { valid: false, error: "topology.links must be an array" };
  }

  // Validate node shapes
  const nodes = topo.nodes as unknown[];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Record<string, unknown>;
    if (typeof node?.id !== "string") {
      return { valid: false, error: `topology.nodes[${i}] missing string id` };
    }
    if (!["router", "switch", "host"].includes(node.type as string)) {
      return { valid: false, error: `topology.nodes[${i}] invalid type: ${node.type}` };
    }
  }

  // Validate link shapes
  const links = topo.links as unknown[];
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as Record<string, unknown>;
    if (typeof link?.id !== "string") {
      return { valid: false, error: `topology.links[${i}] missing string id` };
    }
    const src = link.source as Record<string, unknown> | undefined;
    const tgt = link.target as Record<string, unknown> | undefined;
    if (typeof src?.node !== "string" || typeof src?.interface !== "string") {
      return { valid: false, error: `topology.links[${i}] invalid source` };
    }
    if (typeof tgt?.node !== "string" || typeof tgt?.interface !== "string") {
      return { valid: false, error: `topology.links[${i}] invalid target` };
    }
    // state is required by the schema — treat missing/invalid as "up" with a warning
    if (link.state === undefined) {
      return { valid: false, error: `topology.links[${i}] missing required field "state"` };
    }
    if (link.state !== "up" && link.state !== "down") {
      return {
        valid: false,
        error: `topology.links[${i}] invalid state: "${link.state}" (expected "up" or "down")`,
      };
    }
  }

  return { valid: true, ir: data as NetXrayIR };
}

export async function loadIRFromFile(file: File): Promise<NetXrayIR> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(file.size / 1_048_576).toFixed(1)} MB (max ${MAX_FILE_SIZE / 1_048_576} MB)`
    );
  }
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON: file is not valid JSON");
  }
  const result = validateIR(data);
  if (!result.valid) {
    throw new Error(result.error);
  }
  return result.ir;
}

/** Fetch a URL with a timeout, returning the parsed and validated IR. */
async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
    return await response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadIRFromUrl(url: string): Promise<NetXrayIR> {
  const data = await fetchWithTimeout(url);
  const result = validateIR(data);
  if (!result.valid) {
    throw new Error(result.error);
  }
  return result.ir;
}

export async function fetchTopologyList(): Promise<{ name: string; node_count: number; link_count: number }[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/topologies", { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to fetch topology list: ${response.statusText}`);
    const data = await response.json() as { topologies: { name: string; node_count: number; link_count: number }[] };
    return data.topologies;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
