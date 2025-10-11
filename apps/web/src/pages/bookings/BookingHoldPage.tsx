import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type PropertyOption = { id: string; title: string };
type BookingHoldResponse = {
  id: string;
  status: 'HOLD' | 'REVIEW' | 'CANCELLED';
  totalPrice: number;
  holdExpiresAt?: string | null;
  fraud?: {
    level: string;
    score: number;
    reasons: string[];
  };
};

const propertiesKey = ['properties', 'options'];

function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BookingHoldPage() {
  const { user } = useAuth();
  const [formState, setFormState] = useState({
    propertyId: '',
    checkIn: '',
    checkOut: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingHoldResponse | null>(null);

  const propertiesQuery = useQuery<PropertyOption[]>({
    queryKey: propertiesKey,
    queryFn: async () => {
      const { data } = await api.get<{ items: PropertyOption[] }>(
        '/properties',
        {
          params: { take: 50 },
        },
      );
      return data.items;
    },
  });

  const holdMutation = useMutation({
    mutationFn: async ({
      propertyId,
      checkIn,
      checkOut,
    }: {
      propertyId: string;
      checkIn: string;
      checkOut: string;
    }) => {
      if (!user?.id) {
        throw new Error('You must be logged in to create a hold.');
      }

      const headers = {
        'X-User-Id': user.id,
        'Idempotency-Key': generateIdempotencyKey(),
      };

      const { data } = await api.post<BookingHoldResponse>(
        '/bookings/hold',
        {
          propertyId,
          checkIn,
          checkOut,
        },
        { headers },
      );

      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      const apiError = toApiError(err);
      setError(apiError.message);
      setResult(null);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    holdMutation.mutate(formState);
  };

  const propertyOptions = useMemo(
    () => propertiesQuery.data ?? [],
    [propertiesQuery.data],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create booking hold</h1>
        <p className="text-sm text-muted-foreground">
          Reserve inventory for a guest while payments or reviews are pending.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hold request</CardTitle>
          <CardDescription>
            Select a property and provide the desired stay range. The backend
            will automatically determine if the booking should be placed on hold
            or routed to manual review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="propertyId">Property</Label>
              <select
                id="propertyId"
                required
                value={formState.propertyId}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    propertyId: event.target.value,
                  }))
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Select property</option>
                {propertyOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkIn">Check-in</Label>
              <Input
                id="checkIn"
                type="date"
                required
                value={formState.checkIn}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    checkIn: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkOut">Check-out</Label>
              <Input
                id="checkOut"
                type="date"
                required
                value={formState.checkOut}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    checkOut: event.target.value,
                  }))
                }
              />
            </div>
            {error ? (
              <p className="md:col-span-2 text-sm text-destructive">{error}</p>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" disabled={holdMutation.isPending}>
                {holdMutation.isPending ? 'Creating hold…' : 'Create hold'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Hold created</CardTitle>
            <CardDescription>
              Booking ID <span className="font-mono">{result.id}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Status:{' '}
              <span className="font-medium">
                {result.status === 'REVIEW'
                  ? 'Requires manual review'
                  : result.status}
              </span>
            </p>
            <p>Total price: {result.totalPrice.toLocaleString()} VND</p>
            <p>
              Hold expires at:{' '}
              {result.holdExpiresAt
                ? new Date(result.holdExpiresAt).toLocaleString()
                : 'N/A'}
            </p>
            {result.fraud ? (
              <div>
                <p className="font-medium">Fraud assessment</p>
                <p>
                  Level: <span className="capitalize">{result.fraud.level}</span>{' '}
                  · Score: {result.fraud.score}
                </p>
                {result.fraud.reasons.length ? (
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    {result.fraud.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
