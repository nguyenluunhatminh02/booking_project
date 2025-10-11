import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type HealthResponse = {
  status: string;
  version?: string;
  uptime?: number;
  checks?: {
    database?: boolean;
    redis?: boolean;
    timestamp?: string;
  };
};

async function fetchHealth(): Promise<HealthResponse> {
  const res = await api.get<HealthResponse>('/health/ready');
  return res.data;
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 30_000,
  });
}
