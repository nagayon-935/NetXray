/**
 * Simulation state sharing utilities.
 *
 * `encodeShareState` compresses an arbitrary state object with gzip and encodes
 * it as a base64url string suitable for embedding in a URL fragment.
 *
 * `decodeShareState` is the inverse.
 *
 * Encoding pipeline:  JSON → gzip (CompressionStream) → base64url
 * Decoding pipeline:  base64url → gzip (DecompressionStream) → JSON
 */

import type { NetXrayIR } from "../types/netxray-ir";
import type { FailureSpec } from "../engine/types";
import type { ViewId } from "./views";
import type { Snapshot } from "../stores/snapshot-store";

/** Serialisable subset of application state included in a share link. */
export interface SharePayload {
  ir: NetXrayIR;
  snapshots?: Array<Pick<Snapshot, "id" | "timestamp" | "label" | "trigger" | "ir">>;
  /** Active What-If failures so the recipient sees the same failure scenario. */
  failures?: FailureSpec[];
  /** Active view (physical / l2 / l3 / overlay). */
  activeView?: ViewId;
  /** Schema version — bump when the payload shape changes. */
  v: number;
}

const PAYLOAD_VERSION = 1;

// ─── Encode ──────────────────────────────────────────────────────────────────

export async function encodeShareState(state: SharePayload): Promise<string> {
  const json = JSON.stringify({ ...state, v: PAYLOAD_VERSION });
  const encoded = new TextEncoder().encode(json);

  const compressedStream = new Blob([encoded])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));

  const compressedBuffer = await new Response(compressedStream).arrayBuffer();

  // Convert ArrayBuffer → base64 safely (avoid spread which overflows the call
  // stack for buffers larger than ~65 k bytes).
  const bytes = new Uint8Array(compressedBuffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  // Encode as base64url (URL-safe, no padding)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── Decode ──────────────────────────────────────────────────────────────────

export async function decodeShareState(encoded: string): Promise<SharePayload> {
  // Restore standard base64 from base64url
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const decompressedStream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));

  const json = await new Response(decompressedStream).text();
  return JSON.parse(json) as SharePayload;
}
