/**
 * Simulation state sharing utilities.
 * Compresses the current IR and simulation state into a URL-safe string.
 */

export async function encodeShareState(state: any): Promise<string> {
  const json = JSON.stringify(state);
  const stream = new Blob([json]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const compressedResponse = new Response(compressedStream);
  const compressedBuffer = await compressedResponse.arrayBuffer();
  
  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...new Uint8Array(compressedBuffer)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeShareState(encoded: string): Promise<any> {
  // Restore base64 from base64url
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  const decompressedStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decompressedResponse = new Response(decompressedStream);
  const json = await decompressedResponse.text();
  
  return JSON.parse(json);
}
