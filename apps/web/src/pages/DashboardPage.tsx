import { useMemo } from 'react';
import { RefreshCw, Server, TrendingUp } from 'lucide-react';
import { useHealth } from '@/hooks/useHealth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const healthLabel = (status?: string) => {
  switch (status) {
    case 'ok':
    case 'healthy':
      return { label: 'Online', variant: 'default' as const };
    case 'degraded':
      return { label: 'Degraded', variant: 'secondary' as const };
    case 'unhealthy':
      return { label: 'Offline', variant: 'destructive' as const };
    default:
      return { label: 'Unknown', variant: 'outline' as const };
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

const severityColor: Record<string, string> = {
  low: 'bg-secondary text-secondary-foreground',
  medium: 'bg-amber-500/15 text-amber-600',
  high: 'bg-destructive text-destructive-foreground',
};

export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useHealth();

  const health = useMemo(() => {
    if (isError) {
      return { label: 'Error', variant: 'destructive' as const };
    }
    return healthLabel(data?.status);
  }, [data?.status, isError]);

  const lastCheckedText = useMemo(() => {
    if (data?.uptime) {
      const minutes = Math.floor(data.uptime / 60);
      if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
      const hours = (minutes / 60).toFixed(1);
      return `${hours} hours`;
    }

    const iso = data?.checks?.timestamp;
    if (!iso) return 'Unknown';
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return 'Unknown';
    const diffMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
    if (diffMinutes === 0) return 'Just now';
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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase text-muted-foreground">Overview</p>
          <h1 className="text-2xl font-semibold">Operational dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor the NestJS backend and keep an eye on the booking signals.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw
            className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Backend health</CardTitle>
              <CardDescription>
                Live readiness data streamed from the NestJS service.
              </CardDescription>
            </div>
          </div>
          <Badge variant={health.variant}>{health.label}</Badge>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">API base URL</p>
            <p className="font-medium">
              {import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Service version</p>
            {isLoading ? (
              <Skeleton className="mt-1 h-6 w-24" />
            ) : (
              <p className="font-medium">{data?.version ?? 'N/A'}</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Last health check</p>
            {isLoading ? (
              <Skeleton className="mt-1 h-6 w-32" />
            ) : (
              <p className="font-medium">{lastCheckedText}</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Dependencies</p>
            <div className="mt-2 space-y-2">
              {dependencyStatuses.map((dep) => (
                <div
                  key={dep.key}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{dep.label}</span>
                  <Badge variant={dep.value ? 'secondary' : 'destructive'}>
                    {dep.value ? 'Connected' : 'Unavailable'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            Status fetched via <code>GET /health/ready</code>
          </span>
          <div className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4" />
            <span>React Query keeps responses fresh automatically</span>
          </div>
        </CardFooter>
      </Card>

      <section className="grid gap-6 md:grid-cols-2">
        {mockMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader>
              <CardDescription>{metric.title}</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                {metric.value}
                <Badge
                  variant={
                    metric.change.startsWith('-') ? 'destructive' : 'secondary'
                  }
                >
                  {metric.change}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Replace this card with real-time metrics from your analytics or
                data warehouse.
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Operational alerts</CardTitle>
            <CardDescription>
              Surface actionable events from Kafka topics or scheduled jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mockAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{alert.title}</div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      severityColor[alert.severity] ?? severityColor.low,
                    )}
                  >
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {alert.timestamp}
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  Replace this list with data from your alerting service or
                  outbox consumer.
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>
              Suggestions for wiring the dashboard to production systems.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>- Expose booking KPIs through a `/metrics` JSON endpoint.</div>
            <div>- Gate health routes behind authentication for production.</div>
            <div>- Extend React Query with mutations for maintenance tooling.</div>
            <div>- Replace mock alerts with your monitoring provider.</div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
