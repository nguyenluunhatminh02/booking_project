import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { RefreshCw, Server, TrendingUp } from 'lucide-react';
import { useHealth } from '@/hooks/useHealth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
const healthLabel = (status) => {
    switch (status) {
        case 'ok':
        case 'healthy':
            return { label: 'Online', variant: 'default' };
        case 'degraded':
            return { label: 'Degraded', variant: 'secondary' };
        case 'unhealthy':
            return { label: 'Offline', variant: 'destructive' };
        default:
            return { label: 'Unknown', variant: 'outline' };
    }
};
const mockMetrics = [
    { title: 'Bookings (24h)', value: 128, change: '+5.2%' },
    { title: 'Refund Requests', value: 14, change: '+1.8%' },
    { title: 'Fraud Flags', value: 3, change: '-0.4%' },
    { title: 'Messages Today', value: 412, change: '+9.7%' },
];
const mockAlerts = [
    {
        id: 'ALRT-1024',
        title: 'Inventory sync delay detected',
        severity: 'medium',
        timestamp: '5 minutes ago',
    },
    {
        id: 'ALRT-1023',
        title: 'New payout threshold reached',
        severity: 'low',
        timestamp: '22 minutes ago',
    },
    {
        id: 'ALRT-1022',
        title: 'Payment gateway maintenance scheduled',
        severity: 'low',
        timestamp: '1 hour ago',
    },
];
const severityColor = {
    low: 'bg-secondary text-secondary-foreground',
    medium: 'bg-amber-500/15 text-amber-600',
    high: 'bg-destructive text-destructive-foreground',
};
export function DashboardPage() {
    const { data, isLoading, isError, refetch } = useHealth();
    const health = useMemo(() => {
        if (isError) {
            return { label: 'Error', variant: 'destructive' };
        }
        return healthLabel(data?.status);
    }, [data?.status, isError]);
    const lastCheckedText = useMemo(() => {
        if (data?.uptime) {
            const minutes = Math.floor(data.uptime / 60);
            if (minutes < 60)
                return `${minutes} minute${minutes === 1 ? '' : 's'}`;
            const hours = (minutes / 60).toFixed(1);
            return `${hours} hours`;
        }
        const iso = data?.checks?.timestamp;
        if (!iso)
            return 'Unknown';
        const ts = new Date(iso).getTime();
        if (Number.isNaN(ts))
            return 'Unknown';
        const diffMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
        if (diffMinutes === 0)
            return 'Just now';
        if (diffMinutes < 60) {
            return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
        }
        const diffHours = (diffMinutes / 60).toFixed(1);
        return `${diffHours} hours ago`;
    }, [data?.checks?.timestamp, data?.uptime]);
    const dependencyStatuses = [
        { key: 'database', label: 'Database', value: data?.checks?.database },
        { key: 'redis', label: 'Redis cache', value: data?.checks?.redis },
    ];
    return (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase text-muted-foreground", children: "Overview" }), _jsx("h1", { className: "text-2xl font-semibold", children: "Operational dashboard" }), _jsx("p", { className: "mt-1 text-sm text-muted-foreground", children: "Monitor the NestJS backend and keep an eye on the booking signals." })] }), _jsxs(Button, { variant: "outline", onClick: () => refetch(), disabled: isLoading, children: [_jsx(RefreshCw, { className: cn('mr-2 h-4 w-4', isLoading && 'animate-spin') }), "Refresh"] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { className: "flex flex-col gap-2 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary", children: _jsx(Server, { className: "h-5 w-5" }) }), _jsxs("div", { children: [_jsx(CardTitle, { className: "text-xl", children: "Backend health" }), _jsx(CardDescription, { children: "Live readiness data streamed from the NestJS service." })] })] }), _jsx(Badge, { variant: health.variant, children: health.label })] }), _jsxs(CardContent, { className: "grid gap-6 md:grid-cols-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "API base URL" }), _jsx("p", { className: "font-medium", children: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000' })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "Service version" }), isLoading ? (_jsx(Skeleton, { className: "mt-1 h-6 w-24" })) : (_jsx("p", { className: "font-medium", children: data?.version ?? 'N/A' }))] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "Last health check" }), isLoading ? (_jsx(Skeleton, { className: "mt-1 h-6 w-32" })) : (_jsx("p", { className: "font-medium", children: lastCheckedText }))] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "Dependencies" }), _jsx("div", { className: "mt-2 space-y-2", children: dependencyStatuses.map((dep) => (_jsxs("div", { className: "flex items-center justify-between text-sm", children: [_jsx("span", { children: dep.label }), _jsx(Badge, { variant: dep.value ? 'secondary' : 'destructive', children: dep.value ? 'Connected' : 'Unavailable' })] }, dep.key))) })] })] }), _jsxs(CardFooter, { className: "flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between", children: [_jsxs("span", { children: ["Status fetched via ", _jsx("code", { children: "GET /health/ready" })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx(TrendingUp, { className: "h-4 w-4" }), _jsx("span", { children: "React Query keeps responses fresh automatically" })] })] })] }), _jsx("section", { className: "grid gap-6 md:grid-cols-2", children: mockMetrics.map((metric) => (_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardDescription, { children: metric.title }), _jsxs(CardTitle, { className: "flex items-center gap-2 text-3xl", children: [metric.value, _jsx(Badge, { variant: metric.change.startsWith('-') ? 'destructive' : 'secondary', children: metric.change })] })] }), _jsx(CardContent, { children: _jsx("p", { className: "text-sm text-muted-foreground", children: "Replace this card with real-time metrics from your analytics or data warehouse." }) })] }, metric.title))) }), _jsxs("section", { className: "grid gap-6 md:grid-cols-[2fr_1fr]", children: [_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Operational alerts" }), _jsx(CardDescription, { children: "Surface actionable events from Kafka topics or scheduled jobs." })] }), _jsx(CardContent, { className: "space-y-4", children: mockAlerts.map((alert) => (_jsxs("div", { className: "rounded-lg border border-border p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("div", { className: "font-medium", children: alert.title }), _jsx("span", { className: cn('rounded-full px-2 py-0.5 text-xs font-medium', severityColor[alert.severity] ?? severityColor.low), children: alert.severity.toUpperCase() })] }), _jsx("div", { className: "mt-1 text-xs text-muted-foreground", children: alert.timestamp }), _jsx("div", { className: "mt-3 text-sm text-muted-foreground", children: "Replace this list with data from your alerting service or outbox consumer." })] }, alert.id))) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Next steps" }), _jsx(CardDescription, { children: "Suggestions for wiring the dashboard to production systems." })] }), _jsxs(CardContent, { className: "space-y-3 text-sm text-muted-foreground", children: [_jsx("div", { children: "- Expose booking KPIs through a `/metrics` JSON endpoint." }), _jsx("div", { children: "- Gate health routes behind authentication for production." }), _jsx("div", { children: "- Extend React Query with mutations for maintenance tooling." }), _jsx("div", { children: "- Replace mock alerts with your monitoring provider." })] })] })] })] }));
}
