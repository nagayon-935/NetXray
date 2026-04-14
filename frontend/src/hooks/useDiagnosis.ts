import { useState, useCallback } from 'react';
import type { NetXrayIR } from '../types/netxray-ir';

export interface DiagnosisIssue {
  category: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  node_ids: string[];
}

export function useDiagnosis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<DiagnosisIssue[]>([]);

  const runDiagnosis = useCallback(async (ir: NetXrayIR) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ir),
      });

      if (!response.ok) {
        throw new Error(`Diagnosis failed: ${response.statusText}`);
      }

      const data = await response.json();
      setIssues(data.issues);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []); // stable reference — no external deps

  return { runDiagnosis, loading, error, issues };
}
