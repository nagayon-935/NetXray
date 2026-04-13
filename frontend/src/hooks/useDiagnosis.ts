import { useState } from 'react';
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

  const runDiagnosis = async (ir: NetXrayIR) => {
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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { runDiagnosis, loading, error, issues };
}
