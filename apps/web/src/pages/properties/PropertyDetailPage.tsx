import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

type PropertyDetail = {
  id: string;
  title: string;
  address: string;
  description?: string | null;
  createdAt: string;
  amenities?: Record<string, unknown> | null;
  photos?: Array<{
    fileId: string;
    url: string;
    isCover: boolean;
  }>;
};

type AvailabilityDay = {
  id: string;
  date: string;
  price: number;
  remaining: number;
  isBlocked: boolean;
};

type ReviewsResponse = {
  items: Array<{
    id: string;
    rating: number;
    body?: string | null;
    createdAt: string;
  }>;
  hasMore: boolean;
  nextCursor?: string;
};

function formatDate(date: Date) {
  return date.toISOString().split('T')[0]!;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function enumerateDays(start: string, end: string) {
  const out: string[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid date range');
  }
  if (endDate < startDate) {
    throw new Error('End date must be after start date');
  }
  for (
    let cursor = new Date(startDate);
    cursor <= endDate;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    out.push(formatDate(cursor));
  }
  return out;
}

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [availabilityStatus, setAvailabilityStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [availabilityRange, setAvailabilityRange] = useState(() => {
    const today = new Date();
    return {
      from: formatDate(today),
      to: formatDate(addDays(today, 7)),
    };
  });
  const [calendarForm, setCalendarForm] = useState({
    from: '',
    to: '',
    price: '',
    remaining: '',
    isBlocked: false,
  });

  const propertyQuery = useQuery<PropertyDetail>({
    queryKey: ['property', id],
    queryFn: async () => {
      const { data } = await api.get<PropertyDetail>(`/properties/${id}`);
      return data;
    },
    enabled: Boolean(id),
  });

  const property = propertyQuery.data;

  const [formState, setFormState] = useState({
    title: '',
    address: '',
    description: '',
  });

  useEffect(() => {
    if (property) {
      setFormState({
        title: property.title ?? '',
        address: property.address ?? '',
        description: property.description ?? '',
      });
    }
  }, [property]);

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      title?: string;
      address?: string;
      description?: string;
    }) => {
      const { data } = await api.patch(`/properties/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property', id] });
      setUpdateError(null);
    },
    onError: (error) => {
      setUpdateError(toApiError(error).message);
    },
  });

  const reviewsQuery = useQuery<ReviewsResponse>({
    queryKey: ['reviews', id],
    queryFn: async () => {
      const { data } = await api.get<ReviewsResponse>(
        `/reviews?propertyId=${id}&limit=5`,
      );
      return data;
    },
    enabled: Boolean(id),
  });

  const fetchAvailability = useMemo(
    () => async () => {
      if (!id) return;
      setAvailabilityStatus('loading');
      setAvailabilityError(null);
      try {
        const { data } = await api.get<AvailabilityDay[]>(
          `/properties/${id}/calendar`,
          {
            params: {
              from: new Date(availabilityRange.from).toISOString(),
              to: new Date(addDays(new Date(availabilityRange.to), 1)).toISOString(),
            },
          },
        );
        setAvailability(data);
        setAvailabilityStatus('success');
      } catch (error) {
        setAvailabilityStatus('error');
        setAvailabilityError(toApiError(error).message);
      }
    },
    [id, availabilityRange.from, availabilityRange.to],
  );

  useEffect(() => {
    if (id) {
      fetchAvailability();
    }
  }, [id, fetchAvailability]);

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!id) return;
      const { from, to, price, remaining, isBlocked } = calendarForm;
      if (!from || !to) {
        throw new Error('Please provide a start and end date.');
      }
      const items = enumerateDays(from, to).map((date) => ({
        date,
        price: price ? Number(price) : undefined,
        remaining: remaining ? Number(remaining) : undefined,
        isBlocked,
      }));

      await api.post(`/properties/${id}/calendar`, { items });
    },
    onSuccess: () => {
      setCalendarForm({
        from: '',
        to: '',
        price: '',
        remaining: '',
        isBlocked: false,
      });
      setAvailabilityError(null);
      fetchAvailability();
    },
    onError: (error) => {
      setAvailabilityError(toApiError(error).message);
    },
  });

  const handleUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateMutation.mutate({
      title: formState.title,
      address: formState.address,
      description: formState.description,
    });
  };

  if (propertyQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading property…</p>;
  }

  if (!property) {
    return <p className="text-sm text-destructive">Property not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{property.title}</h1>
        <p className="text-sm text-muted-foreground">{property.address}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General information</CardTitle>
          <CardDescription>
            Update the property metadata displayed to guests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleUpdate}>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={formState.title}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formState.address}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    address: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={4}
                value={formState.description}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            {updateError ? (
              <p className="md:col-span-2 text-sm text-destructive">
                {updateError}
              </p>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>
            Inspect and adjust pricing, stock, or block dates for this property.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid items-end gap-4 md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              fetchAvailability();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={availabilityRange.from}
                onChange={(event) =>
                  setAvailabilityRange((prev) => ({
                    ...prev,
                    from: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={availabilityRange.to}
                onChange={(event) =>
                  setAvailabilityRange((prev) => ({
                    ...prev,
                    to: event.target.value,
                  }))
                }
              />
            </div>
            <Button
              type="submit"
              className="md:col-span-2"
              disabled={availabilityStatus === 'loading'}
            >
              {availabilityStatus === 'loading'
                ? 'Loading…'
                : 'Refresh availability'}
            </Button>
          </form>
          {availabilityStatus === 'error' && availabilityError ? (
            <p className="text-sm text-destructive">{availabilityError}</p>
          ) : null}
          {availability.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Remaining</th>
                    <th className="px-3 py-2 font-medium">Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {availability.map((day) => (
                    <tr key={day.id} className="border-b last:border-none">
                      <td className="px-3 py-2">
                        {new Date(day.date).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">{day.price.toLocaleString()}</td>
                      <td className="px-3 py-2">{day.remaining}</td>
                      <td className="px-3 py-2">
                        {day.isBlocked ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No availability records for the selected range.
            </p>
          )}

          <form
            className="grid gap-4 border-t border-border pt-4 md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              upsertMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="cal-from">From</Label>
              <Input
                id="cal-from"
                type="date"
                value={calendarForm.from}
                onChange={(event) =>
                  setCalendarForm((prev) => ({
                    ...prev,
                    from: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-to">To</Label>
              <Input
                id="cal-to"
                type="date"
                value={calendarForm.to}
                onChange={(event) =>
                  setCalendarForm((prev) => ({
                    ...prev,
                    to: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-price">Price (optional)</Label>
              <Input
                id="cal-price"
                type="number"
                min={0}
                value={calendarForm.price}
                onChange={(event) =>
                  setCalendarForm((prev) => ({
                    ...prev,
                    price: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-remaining">Remaining (optional)</Label>
              <Input
                id="cal-remaining"
                type="number"
                min={0}
                value={calendarForm.remaining}
                onChange={(event) =>
                  setCalendarForm((prev) => ({
                    ...prev,
                    remaining: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={calendarForm.isBlocked}
                  onChange={(event) =>
                    setCalendarForm((prev) => ({
                      ...prev,
                      isBlocked: event.target.checked,
                    }))
                  }
                />
                Block dates
              </label>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? 'Updating…' : 'Apply changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent reviews</CardTitle>
          <CardDescription>
            Snapshot of the latest guest feedback associated with this listing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reviewsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading reviews…</p>
          ) : reviewsQuery.data?.items?.length ? (
            <ul className="space-y-4">
              {reviewsQuery.data.items.map((review) => (
                <li
                  key={review.id}
                  className="rounded-lg border border-border p-4"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      Rating: {review.rating}/5
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(review.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {review.body ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {review.body}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reviews yet for this property.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
