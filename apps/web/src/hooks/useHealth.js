import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
async function fetchHealth() {
    const res = await api.get('/health/ready');
    return res.data;
}
export function useHealth() {
    return useQuery({
        queryKey: ['health'],
        queryFn: fetchHealth,
        staleTime: 30_000,
    });
}
