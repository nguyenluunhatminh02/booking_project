import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/lib/toast';

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cancelAt, setCancelAt] = useState<string>('');

  const bookingQ = useQuery<any | null>({
    queryKey: ['booking', id],
    queryFn: async () => {
      const { data } = await api.get(`/bookings/${id}`);
      return data;
    },
    enabled: !!id,
  });

  const previewQ = useQuery<any>({
    queryKey: ['booking', id, 'preview', cancelAt],
    queryFn: async () => {
      const params = cancelAt
        ? `?cancelAt=${encodeURIComponent(new Date(cancelAt).toISOString())}`
        : '';
      const { data } = await api.get(`/bookings/${id}/preview-refund${params}`);
      return data;
    },
    enabled: !!id && !!cancelAt,
  });

  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const status = bookingQ.data?.status;
      if (status === 'HOLD' || status === 'REVIEW') {
        const { data } = await api.post(`/bookings/${bookingId}/cancel`, {
          userId: user?.id,
        });
        return data;
      }
      const { data } = await api.post(
        `/bookings/${bookingId}/cancel-paid-or-confirmed`,
        { userId: user?.id },
      );
      return data;
    },
    onMutate: async (bookingId: string) => {
      await queryClient.cancelQueries({ queryKey: ['booking', id] });
      const previous = queryClient.getQueryData(['booking', id]);
      queryClient.setQueryData(['booking', id], (old: any) => ({
        ...old,
        status: 'CANCELLED',
      }));
      queryClient.setQueryData(['bookings', 'my'], (old: any[]) =>
        old?.map((b) =>
          b.id === bookingId ? { ...b, status: 'CANCELLED' } : b,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.previous)
        queryClient.setQueryData(['booking', id], ctx.previous);
      toast.toast({
        title: 'Cancel failed',
        description: toApiError(err).message,
        variant: 'error',
      });
    },
    onSuccess: () => {
      toast.toast({ title: 'Cancelled', variant: 'success' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['booking', id] });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'my'] });
    },
  });

  if (bookingQ.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  const b: any = bookingQ.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Booking detail</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{b?.property?.title ?? 'Booking'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div>
              Booking ID: <span className="font-mono">{b?.id}</span>
            </div>
            <div>
              Status: <span className="font-medium">{b?.status}</span>
            </div>
            <div>
              Dates: {b?.checkIn ? new Date(b.checkIn).toLocaleString() : '-'} →{' '}
              {b?.checkOut ? new Date(b.checkOut).toLocaleString() : '-'}
            </div>
            <div>Total: {b?.totalPrice?.toLocaleString()} VND</div>
          </div>

          <hr className="my-4" />

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="block text-sm">Preview refund (cancelAt)</label>
              <input
                type="date"
                value={cancelAt}
                onChange={(e) => setCancelAt(e.target.value)}
                className="h-9 w-full rounded-md border border-input px-3"
              />
            </div>
            <div className="md:col-span-3">
              <Button onClick={() => previewQ.refetch()} disabled={!cancelAt}>
                Preview refund
              </Button>
              {previewQ.data ? (
                <pre className="mt-3 whitespace-pre-wrap text-sm">
                  {JSON.stringify(previewQ.data, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>

          <div className="pt-4">
            {b?.status !== 'CANCELLED' ? (
              <Button
                variant="destructive"
                onClick={() => {
                  if (!confirm('Are you sure you want to cancel this booking?'))
                    return;
                  cancelMutation.mutate(b.id);
                }}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel booking'}
              </Button>
            ) : (
              <div className="text-sm text-muted-foreground">
                This booking is cancelled.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
