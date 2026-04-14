import { useState } from 'react';
import { NetXrayIR } from '../types/netxray-ir';

interface ConfigGenResponse {
  node_id: string;
  vendor: string;
  commands: string[];
}

export function useConfigGen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfigGenResponse | null>(null);

  const generateConfig = async (baseIR: NetXrayIR, targetIR: NetXrayIR, nodeId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/config/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_ir: baseIR,
          target_ir: targetIR,
          node_id: nodeId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate config: ${response.statusText}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { generateConfig, loading, error, result };
}
