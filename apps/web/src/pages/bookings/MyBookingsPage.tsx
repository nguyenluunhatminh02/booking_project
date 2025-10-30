// automatic JSX runtime: no top-level React import required
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/lib/toast';

type BookingListItem = {
  id: string;
  status: string;
  totalPrice: number;
  checkIn: string;
  checkOut: string;
  property?: { id: string; title: string } | null;
};

export function MyBookingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const bookingsQ = useQuery<BookingListItem[]>({
    queryKey: ['bookings', 'my'],
    queryFn: async () => {
      const headers = user?.id ? { 'X-User-Id': user.id } : {};
      const { data } = await api.get<BookingListItem[]>('/bookings/my', {
        headers,
      });
      return data;
    },
    enabled: !!user?.id,
  });

  const cancelMutation = useMutation({
    mutationFn: async ({
      bookingId,
      status,
    }: {
      bookingId: string;
      status: string;
    }) => {
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
    onMutate: async ({ bookingId }) => {
      await queryClient.cancelQueries({ queryKey: ['bookings', 'my'] });
      const previous = queryClient.getQueryData<BookingListItem[] | undefined>([
        'bookings',
        'my',
      ]);
      queryClient.setQueryData<BookingListItem[] | undefined>(
        ['bookings', 'my'],
        (old) =>
          old?.map((b) =>
            b.id === bookingId ? { ...b, status: 'CANCELLED' } : b,
          ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.previous)
        queryClient.setQueryData(['bookings', 'my'], ctx.previous);
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
      queryClient.invalidateQueries({ queryKey: ['bookings', 'my'] });
    },
  });

  const list = bookingsQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My bookings</h1>
        <p className="text-sm text-muted-foreground">
          All bookings associated with your account.
        </p>
      </div>

      {bookingsQ.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {list.map((b) => (
          <Card key={b.id}>
            <CardHeader>
              <CardTitle>
                {b.property?.title ?? 'Booking'}
                <div className="text-sm text-muted-foreground">
                  {new Date(b.checkIn).toLocaleDateString()} →{' '}
                  {new Date(b.checkOut).toLocaleDateString()}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div>
                <div className="text-sm">
                  Status: <span className="font-medium">{b.status}</span>
                </div>
                <div className="text-sm">
                  Total: {b.totalPrice.toLocaleString()} VND
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Link to={`/bookings/${b.id}`} className="text-sm underline">
                  Details
                </Link>
                {b.status !== 'CANCELLED' ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (!confirm('Cancel this booking?')) return;
                      cancelMutation.mutate({
                        bookingId: b.id,
                        status: b.status,
                      });
                    }}
                    disabled={cancelMutation.isPending}
                  >
                    {cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
